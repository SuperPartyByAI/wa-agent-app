/**
 * Autonomy Policy Engine
 *
 * Determines what the AI agent can do autonomously per action type.
 * Returns clear, auditable autonomy decisions.
 *
 * Levels:
 *   - full:       AI can act without human approval
 *   - supervised: AI can act but operator should review
 *   - blocked:    AI must NOT act — escalate to human
 *
 * @param {object} params
 * @param {string} params.action              - action being evaluated
 * @param {object} params.decision            - LLM decision object
 * @param {object} params.mutation            - mutation detected
 * @param {object} params.progression         - from evaluateNextStep()
 * @param {object} params.serviceConfidence   - from evaluateServiceConfidence()
 * @param {string} params.conversationStage   - current conversation stage
 * @returns {object} autonomy decision
 */
export function evaluateAutonomy({
    action,
    decision,
    mutation,
    progression,
    serviceConfidence,
    conversationStage
}) {
    const confidence = decision?.confidence_score || 0;
    const mutationType = mutation?.mutation_type || 'no_mutation';
    const mutationConfidence = mutation?.mutation_confidence || 0;
    const stage = conversationStage || decision?.conversation_stage || 'lead';

    // ── Action-level autonomy rules ──

    // Always allowed autonomously
    const FULL_AUTONOMY_ACTIONS = [
        'ask_missing_info',
        'confirm_understanding',
        'discover_services',
        'ask_event_date',
        'ask_location',
        'ask_time',
        'ask_guest_count',
        'ask_service_specific_fields',
        'create_draft',
        'greet_new_lead'
    ];

    // Allowed if confidence is sufficient
    const SUPERVISED_ACTIONS = [
        'change_date',
        'add_service',
        'remove_service',
        'replace_service',
        'change_location',
        'change_time',
        'cancel_event',
        'reactivate_event',
        'confirm_changes'
    ];

    // Never allowed autonomously
    const BLOCKED_ACTIONS = [
        'confirm_quote',
        'confirm_booking',
        'handle_payment',
        'handle_complaint',
        'coordinate_staff',
        'provide_pricing',
        'modify_confirmed_booking'
    ];

    // ── Determine effective action ──
    // Map mutation type to action if relevant
    let effectiveAction = action || progression?.next_step || 'unknown';

    // If a mutation was detected, use it as the action for autonomy check
    if (mutationType !== 'no_mutation') {
        effectiveAction = mutationType;
    }

    // ── Check blocked first ──
    if (BLOCKED_ACTIONS.includes(effectiveAction)) {
        return {
            action_autonomy_allowed: false,
            autonomy_level: 'blocked',
            autonomy_decision_reason: `Acțiunea "${effectiveAction}" necesită aprobare umană.`,
            requires_human_for_action: true,
            effective_action: effectiveAction
        };
    }

    // ── Stage-based blocks ──
    const SENSITIVE_STAGES = ['booking', 'payment', 'coordination', 'completed', 'cancelled'];
    if (SENSITIVE_STAGES.includes(stage) && !['ask_missing_info', 'confirm_understanding'].includes(effectiveAction)) {
        return {
            action_autonomy_allowed: false,
            autonomy_level: 'blocked',
            autonomy_decision_reason: `Conversație în stadiu sensibil "${stage}" — necesită operator.`,
            requires_human_for_action: true,
            effective_action: effectiveAction
        };
    }

    // ── Full autonomy ──
    if (FULL_AUTONOMY_ACTIONS.includes(effectiveAction)) {
        return {
            action_autonomy_allowed: true,
            autonomy_level: 'full',
            autonomy_decision_reason: `Acțiunea "${effectiveAction}" permisă complet autonom.`,
            requires_human_for_action: false,
            effective_action: effectiveAction
        };
    }

    // ── Supervised autonomy (confidence-gated) ──
    if (SUPERVISED_ACTIONS.includes(effectiveAction)) {
        const requiredConfidence = effectiveAction === 'cancel_event' ? 80 : 70;
        const effectiveConfidence = mutationType !== 'no_mutation' ? mutationConfidence : confidence;

        if (effectiveConfidence >= requiredConfidence) {
            return {
                action_autonomy_allowed: true,
                autonomy_level: 'supervised',
                autonomy_decision_reason: `Acțiunea "${effectiveAction}" permisă (confidence=${effectiveConfidence} ≥ ${requiredConfidence}).`,
                requires_human_for_action: false,
                effective_action: effectiveAction
            };
        } else {
            return {
                action_autonomy_allowed: false,
                autonomy_level: 'blocked',
                autonomy_decision_reason: `Acțiunea "${effectiveAction}" blocată — confidence prea mic (${effectiveConfidence} < ${requiredConfidence}).`,
                requires_human_for_action: true,
                effective_action: effectiveAction
            };
        }
    }

    // ── Default: supervised if confidence OK, otherwise blocked ──
    if (confidence >= 70) {
        return {
            action_autonomy_allowed: true,
            autonomy_level: 'supervised',
            autonomy_decision_reason: `Acțiune necunoscută "${effectiveAction}" — permisă supervised (confidence=${confidence}).`,
            requires_human_for_action: false,
            effective_action: effectiveAction
        };
    }

    return {
        action_autonomy_allowed: false,
        autonomy_level: 'blocked',
        autonomy_decision_reason: `Acțiune necunoscută "${effectiveAction}" cu confidence scăzut (${confidence}).`,
        requires_human_for_action: true,
        effective_action: effectiveAction
    };
}
