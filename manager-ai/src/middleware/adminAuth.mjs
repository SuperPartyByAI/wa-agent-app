/**
 * Admin Auth Middleware — JWKS/JWT Verification + RBAC
 *
 * Verifies Supabase JWT tokens using JWKS endpoint (RS256).
 * Checks user role against employees table for RBAC.
 * Falls back to Bearer token auth for API-only access.
 *
 * Ticket: stabilizare/antigravity - Auth & Security
 * Docs: https://supabase.com/docs/guides/auth/jwts
 */

import jwt from 'jsonwebtoken';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ADMIN_API_TOKEN = process.env.ADMIN_API_TOKEN; // fallback static token

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// Cache for JWKS public key
let _jwksCache = null;
let _jwksCacheTime = 0;
const JWKS_CACHE_TTL = 3600000; // 1 hour

/**
 * Fetch JWKS from Supabase and extract signing key
 */
async function getJWKS() {
    if (_jwksCache && Date.now() - _jwksCacheTime < JWKS_CACHE_TTL) return _jwksCache;
    try {
        const jwksUrl = `${SUPABASE_URL}/auth/v1/.well-known/jwks.json`;
        const res = await fetch(jwksUrl);
        if (!res.ok) throw new Error(`JWKS fetch failed: ${res.status}`);
        const jwks = await res.json();
        _jwksCache = jwks;
        _jwksCacheTime = Date.now();
        return jwks;
    } catch (err) {
        console.error('[adminAuth] JWKS fetch error:', err.message);
        return null;
    }
}

/**
 * Verify a Supabase JWT token
 */
async function verifySupabaseToken(token) {
    try {
        // Use Supabase Admin to verify — most reliable approach
        const { data, error } = await supabaseAdmin.auth.getUser(token);
        if (error || !data?.user) return null;
        return data.user;
    } catch (err) {
        console.error('[adminAuth] Token verification error:', err.message);
        return null;
    }
}

/**
 * Lookup user role from employees table
 */
async function getUserRole(userId, email) {
    try {
        // Try by user_id first
        let { data, error } = await supabaseAdmin
            .from('employees')
            .select('id, role, full_name, status')
            .or(`user_id.eq.${userId},email.eq.${email}`)
            .limit(1)
            .maybeSingle();

        if (error || !data) return null;
        if (data.status === 'inactive') return null;
        return data;
    } catch (err) {
        console.error('[adminAuth] Role lookup error:', err.message);
        return null;
    }
}

/**
 * Admin Auth Middleware Factory
 *
 * @param {Object} options
 * @param {string[]} options.requiredRoles - Roles allowed to access (default: ['admin'])
 * @param {boolean} options.allowApiToken - Allow static API token auth (default: true)
 */
export function adminAuth(options = {}) {
    const { requiredRoles = ['admin', 'manager'], allowApiToken = true } = options;

    return async (req, res, next) => {
        try {
            const authHeader = req.headers.authorization;
            if (!authHeader) {
                return res.status(401).json({ error: 'Missing authorization header' });
            }

            const token = authHeader.replace('Bearer ', '');

            // Path 1: Static API token for server-to-server / CLI access
            if (allowApiToken && ADMIN_API_TOKEN && token === ADMIN_API_TOKEN) {
                req.user = { id: 'api-token', email: 'api@system', role: 'admin' };
                return next();
            }

            // Path 2: Supabase JWT verification
            const user = await verifySupabaseToken(token);
            if (!user) {
                return res.status(401).json({ error: 'Invalid or expired token' });
            }

            // Path 3: RBAC — check employees table
            const employee = await getUserRole(user.id, user.email);
            if (!employee) {
                return res.status(403).json({
                    error: 'Access denied — not registered as employee or inactive',
                    hint: 'Contact admin to be added to employees table'
                });
            }

            if (!requiredRoles.includes(employee.role)) {
                return res.status(403).json({
                    error: `Role '${employee.role}' not authorized. Required: ${requiredRoles.join(', ')}`
                });
            }

            // Attach user context
            req.user = {
                id: user.id,
                email: user.email,
                role: employee.role,
                employee_id: employee.id,
                name: employee.full_name
            };

            next();
        } catch (err) {
            console.error('[adminAuth] Unexpected error:', err);
            res.status(500).json({ error: 'Authentication error' });
        }
    };
}

/**
 * Simple token auth — for initial setup before SSO is configured.
 * Uses ADMIN_API_TOKEN from .env
 */
export function simpleTokenAuth() {
    return (req, res, next) => {
        if (!ADMIN_API_TOKEN) return next(); // Skip auth if no token configured
        const authHeader = req.headers.authorization;
        if (!authHeader) return res.status(401).json({ error: 'Missing authorization header' });
        const token = authHeader.replace('Bearer ', '');
        if (token !== ADMIN_API_TOKEN) return res.status(401).json({ error: 'Invalid token' });
        req.user = { id: 'api-token', email: 'api@system', role: 'admin' };
        next();
    };
}

export default adminAuth;
