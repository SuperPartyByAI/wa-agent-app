import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } from '../config/env.mjs';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

/**
 * Rollout State Machine — Phase 3
 * 
 * Valid states:
 *   shadow_only → wave1_candidate → wave1_enabled → wave2_candidate → wave2_enabled
 *   Any state → rollout_blocked (on guardrail trigger)
 *   rollout_blocked → shadow_only (manual reset only)
 */

const VALID_TRANSITIONS = {
    'shadow_only': ['wave1_candidate', 'rollout_blocked'],
    'wave1_candidate': ['wave1_enabled', 'shadow_only', 'rollout_blocked'],
    'wave1_enabled': ['wave2_candidate', 'shadow_only', 'rollout_blocked'],
    'wave2_candidate': ['wave2_enabled', 'wave1_enabled', 'rollout_blocked'],
    'wave2_enabled': ['wave1_enabled', 'rollout_blocked'],
    'rollout_blocked': ['shadow_only']  // manual reset only
};

/**
 * Get current rollout state.
 */
export async function getCurrentRolloutState() {
    const { data, error } = await supabase
        .from('ai_rollout_state')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

    if (error) {
        console.error('[Rollout] State read error:', error.message);
        return { current_state: 'shadow_only', error: error.message };
    }

    return data || { current_state: 'shadow_only' };
}

/**
 * Transition to a new rollout state.
 * @param {string} newState - Target state
 * @param {string} reason - Why the transition is happening
 * @param {string} changedBy - 'system' | 'operator' | 'admin'
 * @param {object} kpiSnapshot - KPI data at time of transition
 * @param {string[]} blockers - Active blockers (if blocking)
 * @returns {{ success: boolean, error?: string }}
 */
export async function transitionRolloutState(newState, reason, changedBy = 'system', kpiSnapshot = null, blockers = null) {
    const current = await getCurrentRolloutState();
    const currentState = current.current_state;

    // Validate transition
    const allowed = VALID_TRANSITIONS[currentState];
    if (!allowed || !allowed.includes(newState)) {
        const msg = `Invalid transition: ${currentState} → ${newState}. Allowed: ${(allowed || []).join(', ')}`;
        console.error(`[Rollout] ${msg}`);
        return { success: false, error: msg };
    }

    // Insert new state row (append-only audit trail)
    const { error } = await supabase.from('ai_rollout_state').insert({
        current_state: newState,
        previous_state: currentState,
        transition_reason: reason,
        changed_by: changedBy,
        kpi_snapshot: kpiSnapshot,
        blockers
    });

    if (error) {
        console.error('[Rollout] Transition error:', error.message);
        return { success: false, error: error.message };
    }

    console.log(`[Rollout] ${currentState} → ${newState} (by=${changedBy}, reason=${reason})`);
    return { success: true, from: currentState, to: newState };
}

/**
 * Auto-evaluate and potentially transition based on gate results.
 * Does NOT auto-enable waves — only promotes to candidate.
 * @param {object} gateResult - Output from evaluateFullGate()
 */
export async function autoEvaluateRollout(gateResult) {
    const current = await getCurrentRolloutState();
    const currentState = current.current_state;

    // Hard blocker — block immediately
    if (gateResult.has_hard_blockers && currentState !== 'rollout_blocked') {
        const blockReasons = [
            ...gateResult.wave1.blockers.filter(b => b.startsWith('duplicate') || b.startsWith('double_dispatch') || b.startsWith('dangerous')),
        ];
        return await transitionRolloutState('rollout_blocked', 
            `guardrail: ${blockReasons.join('; ')}`, 'system', null, blockReasons);
    }

    // Promote to wave1_candidate if eligible and in shadow_only
    if (currentState === 'shadow_only' && gateResult.wave1.eligible) {
        return await transitionRolloutState('wave1_candidate',
            'wave1_gate_passed', 'system', gateResult);
    }

    // Promote to wave2_candidate if eligible and in wave1_enabled  
    if (currentState === 'wave1_enabled' && gateResult.wave2.eligible) {
        return await transitionRolloutState('wave2_candidate',
            'wave2_gate_passed', 'system', gateResult);
    }

    return { success: true, action: 'maintain_current', state: currentState };
}

/**
 * Get rollout state history.
 */
export async function getRolloutHistory(limit = 20) {
    const { data, error } = await supabase
        .from('ai_rollout_state')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(limit);
    if (error) return { error: error.message };
    return data || [];
}
