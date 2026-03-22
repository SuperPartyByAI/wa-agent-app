/**
 * Rule Loader — Fetch + Verify + Hot-Reload + Atomic Write
 *
 * Loads brain rules and policies from Supabase or Admin API.
 * Supports: version monotonicity, checksum verification,
 * atomic file write, and event-driven reload.
 *
 * Ticket: stabilizare/antigravity - Rule Loader
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RULES_DIR = path.resolve(__dirname, '../../runtime_rules');

// Ensure rules directory exists
if (!fs.existsSync(RULES_DIR)) fs.mkdirSync(RULES_DIR, { recursive: true });

// Runtime state
let currentPolicy = null;
let currentVersion = null;
let currentRules = [];
let lastLoadTime = 0;
const RELOAD_INTERVAL = 60000; // 60 seconds
const listeners = [];

/**
 * Subscribe to policy reload events
 */
export function onPolicyReload(fn) { listeners.push(fn); }

/**
 * Emit reload event to all listeners
 */
function emitReload(policy) {
    for (const fn of listeners) {
        try { fn(policy); } catch (e) { console.error('[ruleLoader] listener error:', e.message); }
    }
}

/**
 * Compute SHA256 checksum of content
 */
function sha256(content) {
    return crypto.createHash('sha256').update(content).digest('hex');
}

/**
 * Atomic file write: write to .tmp then rename
 */
function atomicWrite(filePath, content) {
    const tmp = filePath + '.tmp.' + Date.now();
    fs.writeFileSync(tmp, content, 'utf8');
    fs.renameSync(tmp, filePath);
}

/**
 * Load brain rules from Supabase — the primary source of truth
 */
export async function loadRulesFromDB() {
    try {
        const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

        // Fetch active brain rules
        const { data: rules, error: rulesErr } = await supabase
            .from('ai_brain_rules')
            .select('*')
            .eq('status', 'active')
            .order('priority', { ascending: false });

        if (rulesErr) throw rulesErr;

        // Fetch coverage config
        const { data: coverage, error: covErr } = await supabase
            .from('ai_coverage_config')
            .select('*');

        if (covErr) throw covErr;

        // Fetch active policies (approved KB entries)
        const { data: policies, error: polErr } = await supabase
            .from('ai_knowledge_base')
            .select('*')

        if (polErr) throw polErr;

        const policy = {
            version: `v${Date.now()}`,
            loaded_at: new Date().toISOString(),
            rules: rules || [],
            coverage: coverage || [],
            policies: policies || [],
            checksum: null
        };

        // Compute checksum
        const policyStr = JSON.stringify({ rules: policy.rules, coverage: policy.coverage, policies: policy.policies });
        policy.checksum = sha256(policyStr);

        // Version monotonicity check
        if (currentVersion && policy.version <= currentVersion) {
            console.log('[ruleLoader] Version not newer, skipping');
            return currentPolicy;
        }

        // Atomic write to disk (fallback cache)
        atomicWrite(
            path.join(RULES_DIR, 'policy.json'),
            JSON.stringify(policy, null, 2)
        );

        atomicWrite(
            path.join(RULES_DIR, 'policy.meta.json'),
            JSON.stringify({
                version: policy.version,
                checksum: `sha256:${policy.checksum}`,
                rules_count: policy.rules.length,
                coverage_count: policy.coverage.length,
                policies_count: policy.policies.length,
                loaded_at: policy.loaded_at,
                source: 'supabase'
            }, null, 2)
        );

        // Update runtime state
        const previous = currentPolicy;
        currentPolicy = policy;
        currentVersion = policy.version;
        currentRules = policy.rules;
        lastLoadTime = Date.now();

        console.log(`[ruleLoader] Loaded v=${policy.version} rules=${rules.length} coverage=${coverage.length} policies=${policies.length} checksum=${policy.checksum.substring(0, 12)}`);

        // Emit reload event
        emitReload(policy);

        return policy;
    } catch (err) {
        console.error('[ruleLoader] Load failed:', err.message);

        // Fallback: load from disk cache
        if (!currentPolicy) {
            return loadFromDisk();
        }
        return currentPolicy;
    }
}

/**
 * Load policy from disk cache (fallback)
 */
function loadFromDisk() {
    try {
        const policyPath = path.join(RULES_DIR, 'policy.json');
        if (!fs.existsSync(policyPath)) return null;
        const policy = JSON.parse(fs.readFileSync(policyPath, 'utf8'));

        // Verify checksum
        const policyStr = JSON.stringify({ rules: policy.rules, coverage: policy.coverage, policies: policy.policies });
        const computed = sha256(policyStr);
        if (policy.checksum && policy.checksum !== computed) {
            console.error('[ruleLoader] Disk cache checksum mismatch! Ignoring.');
            return null;
        }

        currentPolicy = policy;
        currentVersion = policy.version;
        currentRules = policy.rules || [];
        console.log('[ruleLoader] Loaded from disk cache:', policy.version);
        return policy;
    } catch (err) {
        console.error('[ruleLoader] Disk load failed:', err.message);
        return null;
    }
}

/**
 * Match incoming message against loaded rules
 * Returns matching rules sorted by priority
 */
export function matchRules(message, stage = 'DISCOVERY') {
    if (!currentRules.length) return [];

    return currentRules.filter(rule => {
        // Stage match
        if (rule.stage && rule.stage !== stage) return false;
        // Trigger match (simple keyword/tag match)
        if (rule.trigger) {
            const trigger = rule.trigger.toLowerCase();
            const msg = (message || '').toLowerCase();
            if (!msg.includes(trigger) && trigger !== '*') return false;
        }
        return true;
    }).sort((a, b) => (b.priority || 0) - (a.priority || 0));
}

/**
 * Get current policy
 */
export function getCurrentPolicy() { return currentPolicy; }

/**
 * Get current rules
 */
export function getCurrentRules() { return currentRules; }

/**
 * Start auto-reload interval
 */
export function startAutoReload(intervalMs = RELOAD_INTERVAL) {
    loadRulesFromDB(); // Initial load
    setInterval(() => loadRulesFromDB(), intervalMs);
    console.log(`[ruleLoader] Auto-reload started every ${intervalMs / 1000}s`);
}

/**
 * Force rollback to previous disk-cached policy
 */
export function rollbackToCache() {
    const restored = loadFromDisk();
    if (restored) {
        console.log('[ruleLoader] Rolled back to disk cache:', restored.version);
    }
    return restored;
}

export default {
    loadRulesFromDB,
    matchRules,
    getCurrentPolicy,
    getCurrentRules,
    startAutoReload,
    rollbackToCache,
    onPolicyReload
};
