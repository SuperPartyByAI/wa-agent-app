import {
    AI_WAVE1_MIN_APPROVAL_RATE,
    AI_WAVE1_MAX_DANGEROUS_RATE,
    AI_WAVE1_MAX_WRONG_TOOL_RATE,
    AI_WAVE1_MAX_CLARIFICATION_FAILURE_RATE,
    AI_WAVE1_MIN_SAMPLE_SIZE,
    AI_WAVE2_MIN_APPROVAL_RATE,
    AI_WAVE2_MAX_EDIT_RATE,
    AI_WAVE2_MIN_SAMPLE_SIZE
} from '../config/env.mjs';

/**
 * Rollout Gate — Phase 3
 * 
 * Evaluates whether Wave 1 or Wave 2 can be activated based on analytics KPIs.
 * Returns { eligible, blockers[] } for each wave.
 */

/**
 * Check if a specific DB column exists in ai_reply_decisions.
 * Used as a guardrail before allowing rollout.
 */
export async function checkSchemaReady(supabase) {
    const requiredCols = ['safety_class', 'operational_mode', 'operator_verdict', 'memory_context_used'];
    const missing = [];
    for (const col of requiredCols) {
        const { error } = await supabase.from('ai_reply_decisions').select(col).limit(1);
        if (error && error.message.includes('does not exist')) missing.push(col);
    }
    return { ready: missing.length === 0, missing };
}

/**
 * Evaluate Wave 1 gate.
 * @param {object} kpis - Output from computeShadowAnalytics()
 * @returns {{ eligible: boolean, blockers: string[] }}
 */
export function evaluateWave1Gate(kpis) {
    const blockers = [];

    // Minimum sample size
    if (kpis.total_with_feedback < AI_WAVE1_MIN_SAMPLE_SIZE) {
        blockers.push(`insufficient_samples: ${kpis.total_with_feedback}/${AI_WAVE1_MIN_SAMPLE_SIZE}`);
    }

    // Approval rate
    if (kpis.approval_rate < AI_WAVE1_MIN_APPROVAL_RATE) {
        blockers.push(`approval_rate_low: ${kpis.approval_rate}% < ${AI_WAVE1_MIN_APPROVAL_RATE}%`);
    }

    // Dangerous rate
    if (kpis.verdict_breakdown.dangerous > AI_WAVE1_MAX_DANGEROUS_RATE) {
        blockers.push(`dangerous_rate_high: ${kpis.verdict_breakdown.dangerous}% > ${AI_WAVE1_MAX_DANGEROUS_RATE}%`);
    }

    // Wrong tool rate
    if (kpis.verdict_breakdown.wrong_tool > AI_WAVE1_MAX_WRONG_TOOL_RATE) {
        blockers.push(`wrong_tool_high: ${kpis.verdict_breakdown.wrong_tool}% > ${AI_WAVE1_MAX_WRONG_TOOL_RATE}%`);
    }

    // Misunderstood client
    if (kpis.verdict_breakdown.misunderstood_client > AI_WAVE1_MAX_WRONG_TOOL_RATE) {
        blockers.push(`misunderstood_client_high: ${kpis.verdict_breakdown.misunderstood_client}%`);
    }

    // Clarification failures
    if (kpis.verdict_breakdown.should_have_clarified > AI_WAVE1_MAX_CLARIFICATION_FAILURE_RATE) {
        blockers.push(`clarification_failure: ${kpis.verdict_breakdown.should_have_clarified}% > ${AI_WAVE1_MAX_CLARIFICATION_FAILURE_RATE}%`);
    }

    // Unnecessary questions
    if (kpis.verdict_breakdown.unnecessary_question > AI_WAVE1_MAX_CLARIFICATION_FAILURE_RATE) {
        blockers.push(`unnecessary_questions: ${kpis.verdict_breakdown.unnecessary_question}%`);
    }

    // Hard blockers: duplicates and double dispatch
    if (kpis.duplicate_outbound > 0) {
        blockers.push(`duplicate_outbound: ${kpis.duplicate_outbound}`);
    }
    if (kpis.double_dispatch > 0) {
        blockers.push(`double_dispatch: ${kpis.double_dispatch}`);
    }

    return { eligible: blockers.length === 0, blockers };
}

/**
 * Evaluate Wave 2 gate.
 * Wave 2 requires Wave 1 to be active and stable.
 * @param {object} kpis - Output from computeShadowAnalytics()
 * @param {string} currentRolloutState - Current rollout state
 * @returns {{ eligible: boolean, blockers: string[] }}
 */
export function evaluateWave2Gate(kpis, currentRolloutState) {
    const blockers = [];

    // Must be in wave1_enabled first
    if (currentRolloutState !== 'wave1_enabled') {
        blockers.push(`prerequisite: must be in wave1_enabled, currently ${currentRolloutState}`);
    }

    // Minimum sample size (higher for wave 2)
    if (kpis.total_with_feedback < AI_WAVE2_MIN_SAMPLE_SIZE) {
        blockers.push(`insufficient_samples: ${kpis.total_with_feedback}/${AI_WAVE2_MIN_SAMPLE_SIZE}`);
    }

    // Higher approval rate
    if (kpis.approval_rate < AI_WAVE2_MIN_APPROVAL_RATE) {
        blockers.push(`approval_rate_low: ${kpis.approval_rate}% < ${AI_WAVE2_MIN_APPROVAL_RATE}%`);
    }

    // Edit rate must be low (operator rarely edits)
    if (kpis.edit_rate > AI_WAVE2_MAX_EDIT_RATE) {
        blockers.push(`edit_rate_high: ${kpis.edit_rate}% > ${AI_WAVE2_MAX_EDIT_RATE}%`);
    }

    // Zero tolerance for dangerous/wrong in wave 2
    if (kpis.verdict_breakdown.dangerous > 0) {
        blockers.push(`dangerous_nonzero: ${kpis.verdict_breakdown.dangerous}%`);
    }
    if (kpis.verdict_breakdown.wrong_tool > 3) {
        blockers.push(`wrong_tool: ${kpis.verdict_breakdown.wrong_tool}%`);
    }

    // Memory/identity errors near zero
    if (kpis.wrong_memory_usage_count > 1) {
        blockers.push(`wrong_memory: ${kpis.wrong_memory_usage_count} errors`);
    }
    if (kpis.verdict_breakdown.misunderstood_client > 2) {
        blockers.push(`misunderstood_client: ${kpis.verdict_breakdown.misunderstood_client}%`);
    }

    // Hard blockers
    if (kpis.duplicate_outbound > 0) blockers.push(`duplicate_outbound: ${kpis.duplicate_outbound}`);
    if (kpis.double_dispatch > 0) blockers.push(`double_dispatch: ${kpis.double_dispatch}`);

    return { eligible: blockers.length === 0, blockers };
}

/**
 * Full gate evaluation — returns status for both waves.
 */
export function evaluateFullGate(kpis, currentRolloutState) {
    const wave1 = evaluateWave1Gate(kpis);
    const wave2 = evaluateWave2Gate(kpis, currentRolloutState);

    return {
        current_state: currentRolloutState,
        wave1: { ...wave1, verdict: wave1.eligible ? 'wave1_candidate' : 'not_ready' },
        wave2: { ...wave2, verdict: wave2.eligible ? 'wave2_candidate' : 'not_ready' },
        has_hard_blockers: kpis.duplicate_outbound > 0 || kpis.double_dispatch > 0 ||
            kpis.verdict_breakdown.dangerous > AI_WAVE1_MAX_DANGEROUS_RATE,
        recommended_action: wave1.eligible && currentRolloutState === 'shadow_only' ? 'promote_to_wave1_candidate'
            : wave2.eligible ? 'promote_to_wave2_candidate'
            : kpis.duplicate_outbound > 0 || kpis.double_dispatch > 0 ? 'block_rollout'
            : 'maintain_current'
    };
}
