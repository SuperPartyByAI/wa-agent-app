import { computeShadowAnalytics } from '../analytics/shadowAnalytics.mjs';
import { getCurrentRolloutState, transitionRolloutState } from './rolloutStateMachine.mjs';
import { checkSchemaReady } from './rolloutGate.mjs';
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } from '../config/env.mjs';
import {
    AI_WAVE1_AUTO_ROLLBACK_ENABLED,
    AI_WAVE1_ROLLBACK_EVAL_WINDOW_HOURS,
    AI_WAVE1_ROLLBACK_MIN_SAMPLE,
    AI_WAVE1_MAX_DUPLICATES_ROLLBACK,
    AI_WAVE1_MAX_DANGEROUS_RATE_ROLLBACK,
    AI_WAVE1_MAX_WRONG_TOOL_RATE_ROLLBACK,
    AI_WAVE1_MAX_MISUNDERSTOOD_RATE_ROLLBACK,
    AI_WAVE1_MAX_CLARIFICATION_FAILURE_ROLLBACK
} from '../config/env.mjs';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

/**
 * Rollback Evaluator — Phase 4
 * 
 * Evaluates 10 trigger conditions and auto-blocks rollout if thresholds breached.
 * Called after each Wave 1 send and periodically.
 */

/**
 * Evaluate whether rollback should be triggered.
 * @param {number} hours - lookback window
 * @returns {{ shouldRollback: boolean, triggers: string[], kpiSnapshot: object }}
 */
export async function evaluateRollback(hours) {
    if (!AI_WAVE1_AUTO_ROLLBACK_ENABLED) {
        return { shouldRollback: false, triggers: ['rollback_disabled'], kpiSnapshot: null };
    }

    const evalHours = hours || AI_WAVE1_ROLLBACK_EVAL_WINDOW_HOURS;
    const kpis = await computeShadowAnalytics(evalHours);
    const triggers = [];

    // Skip if insufficient data
    if (kpis.total_decisions < AI_WAVE1_ROLLBACK_MIN_SAMPLE) {
        return { shouldRollback: false, triggers: ['insufficient_data'], kpiSnapshot: kpis };
    }

    // 1. Duplicate outbound
    if (kpis.duplicate_outbound > AI_WAVE1_MAX_DUPLICATES_ROLLBACK) {
        triggers.push(`duplicate_outbound: ${kpis.duplicate_outbound}`);
    }

    // 2. Double dispatch
    if (kpis.double_dispatch > 0) {
        triggers.push(`double_dispatch: ${kpis.double_dispatch}`);
    }

    // 3. Dangerous rate
    if (kpis.verdict_breakdown.dangerous > AI_WAVE1_MAX_DANGEROUS_RATE_ROLLBACK) {
        triggers.push(`dangerous_rate: ${kpis.verdict_breakdown.dangerous}%`);
    }

    // 4. Wrong tool rate
    if (kpis.verdict_breakdown.wrong_tool > AI_WAVE1_MAX_WRONG_TOOL_RATE_ROLLBACK) {
        triggers.push(`wrong_tool: ${kpis.verdict_breakdown.wrong_tool}%`);
    }

    // 5. Misunderstood client rate
    if (kpis.verdict_breakdown.misunderstood_client > AI_WAVE1_MAX_MISUNDERSTOOD_RATE_ROLLBACK) {
        triggers.push(`misunderstood_client: ${kpis.verdict_breakdown.misunderstood_client}%`);
    }

    // 6. Clarification failure
    if (kpis.verdict_breakdown.should_have_clarified > AI_WAVE1_MAX_CLARIFICATION_FAILURE_ROLLBACK) {
        triggers.push(`clarification_failure: ${kpis.verdict_breakdown.should_have_clarified}%`);
    }

    // 7. Confidence drop (avg below 60)
    if (kpis.avg_confidence < 60) {
        triggers.push(`confidence_drop: avg=${kpis.avg_confidence}`);
    }

    // 8. DB schema mismatch
    const schema = await checkSchemaReady(supabase);
    if (!schema.ready) {
        triggers.push(`schema_mismatch: missing=${schema.missing.join(',')}`);
    }

    // 9. Wrong memory usage spike
    if (kpis.wrong_memory_usage_count > 2) {
        triggers.push(`wrong_memory: ${kpis.wrong_memory_usage_count}`);
    }

    // 10. Very low approval rate (if feedback exists)
    if (kpis.total_with_feedback >= 5 && kpis.approval_rate < 50) {
        triggers.push(`approval_rate_critical: ${kpis.approval_rate}%`);
    }

    return {
        shouldRollback: triggers.length > 0,
        triggers,
        kpiSnapshot: kpis
    };
}

/**
 * Execute auto-rollback if conditions are met.
 * Transitions to rollout_blocked with incident data.
 */
export async function executeAutoRollback() {
    const result = await evaluateRollback();
    if (!result.shouldRollback) {
        return { triggered: false, reason: 'no_triggers' };
    }

    const state = await getCurrentRolloutState();
    if (state.current_state === 'rollout_blocked' || state.current_state === 'shadow_only') {
        return { triggered: false, reason: `already_${state.current_state}` };
    }

    // Save incident
    const incident = {
        type: 'auto_rollback',
        triggers: result.triggers,
        kpi_snapshot: result.kpiSnapshot,
        rollout_state_at_trigger: state.current_state,
        timestamp: new Date().toISOString()
    };

    await supabase.from('ai_rollout_state').insert({
        current_state: 'rollout_blocked',
        previous_state: state.current_state,
        transition_reason: `auto_rollback: ${result.triggers.join('; ')}`,
        changed_by: 'system_rollback',
        kpi_snapshot: result.kpiSnapshot,
        blockers: result.triggers
    });

    console.log(`[Rollback] ⚠️ AUTO-ROLLBACK triggered: ${result.triggers.join(', ')}`);
    return { triggered: true, incident, from: state.current_state };
}
