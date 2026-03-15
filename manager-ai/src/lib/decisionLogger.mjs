/**
 * Decision Logger — Redacted, Append-Only Decision Audit Trail
 *
 * Logs every AI decision with trace ID, policy version, redacted input,
 * and runtime zone. PII is stripped before persistence.
 *
 * Ticket: stabilizare/antigravity - Decision Logging
 */

import { createClient } from '@supabase/supabase-js';

let _supabase = null;

function getSupabase() {
    if (!_supabase) {
        _supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
    }
    return _supabase;
}

// PII patterns for redaction
const PII_PATTERNS = [
    { regex: /\+?\d{10,15}/g, replacement: '[PHONE]' },
    { regex: /[\w.-]+@[\w.-]+\.\w+/g, replacement: '[EMAIL]' },
    { regex: /\b\d{6,8}\b/g, replacement: '[ID_NUMBER]' },
    { regex: /\bRO\d{2,}\b/gi, replacement: '[IBAN]' }
];

/**
 * Redact PII from a string
 */
export function redactPII(text) {
    if (!text || typeof text !== 'string') return text;
    let redacted = text;
    for (const { regex, replacement } of PII_PATTERNS) {
        redacted = redacted.replace(regex, replacement);
    }
    return redacted;
}

/**
 * Deep redact PII from an object
 */
export function redactObject(obj) {
    if (!obj) return obj;
    if (typeof obj === 'string') return redactPII(obj);
    if (Array.isArray(obj)) return obj.map(redactObject);
    if (typeof obj !== 'object') return obj;

    const redacted = {};
    const sensitiveKeys = ['phone', 'email', 'real_phone_e164', 'address', 'billing_details', 'password', 'token', 'secret', 'key'];

    for (const [key, value] of Object.entries(obj)) {
        if (sensitiveKeys.includes(key.toLowerCase())) {
            redacted[key] = typeof value === 'string' ? value.substring(0, 3) + '***' : '[REDACTED]';
        } else if (typeof value === 'string') {
            redacted[key] = redactPII(value);
        } else if (typeof value === 'object') {
            redacted[key] = redactObject(value);
        } else {
            redacted[key] = value;
        }
    }
    return redacted;
}

/**
 * Log a decision to the decision_logs table
 *
 * @param {Object} params
 * @param {string} params.traceId - Unique trace identifier
 * @param {string} params.action - Decision action type
 * @param {string} params.operation - Operation name
 * @param {Object} params.payload - Request data (will be redacted)
 * @param {Object} params.result - Decision result
 * @param {string} params.policyVersion - Active policy version at time of decision
 * @param {string} params.zone - Runtime zone (shadow/canary/production)
 */
export async function logDecision({ traceId, action, operation, payload, result, policyVersion, zone }) {
    try {
        const supabase = getSupabase();
        const redactedPayload = redactObject(payload);

        await supabase.from('decision_logs').insert({
            trace_id: traceId || crypto.randomUUID(),
            request: payload,
            request_redacted: redactedPayload,
            decision: {
                action,
                operation,
                result,
                timestamp: new Date().toISOString()
            },
            policy_version: policyVersion || 'unknown',
            runtime_zone: zone || 'production'
        });
    } catch (err) {
        // Decision logging should never crash the main flow
        console.error('[decisionLogger] Log failed:', err.message);
    }
}

/**
 * Query recent decisions (for Admin UI)
 */
export async function getRecentDecisions(limit = 50, zone = null) {
    try {
        const supabase = getSupabase();
        let query = supabase
            .from('decision_logs')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(limit);

        if (zone) query = query.eq('runtime_zone', zone);

        const { data, error } = await query;
        if (error) throw error;
        return data || [];
    } catch (err) {
        console.error('[decisionLogger] Query failed:', err.message);
        return [];
    }
}

/**
 * Get decision stats for a time window
 */
export async function getDecisionStats(hours = 24) {
    try {
        const supabase = getSupabase();
        const since = new Date(Date.now() - hours * 3600000).toISOString();
        const { data, count } = await supabase
            .from('decision_logs')
            .select('runtime_zone', { count: 'exact' })
            .gte('created_at', since);

        const byZone = {};
        (data || []).forEach(d => { byZone[d.runtime_zone] = (byZone[d.runtime_zone] || 0) + 1; });

        return { total: count || 0, by_zone: byZone, hours };
    } catch (err) {
        console.error('[decisionLogger] Stats failed:', err.message);
        return { total: 0, by_zone: {}, hours };
    }
}

export default { logDecision, getRecentDecisions, getDecisionStats, redactPII, redactObject };
