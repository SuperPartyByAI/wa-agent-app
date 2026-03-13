import {
    AI_SAFE_AUTOREPLY_MIN_CONFIDENCE,
    AI_AUTOREPLY_ALLOWED_STAGES,
    AI_AUTOREPLY_ALLOWED_TOOLS
} from '../config/env.mjs';

/**
 * Safety Classification Engine — Phase 2
 * 
 * Pure function. Classifies every AI reply into one of 3 safety classes:
 *   - safe_autoreply_allowed: can be sent automatically in safe_autoreply_mode
 *   - needs_operator_review: must wait for operator approval
 *   - blocked_autoreply: must NOT be sent under any circumstances
 * 
 * Returns { safetyClass, reasons[] }
 */
export function evaluateSafetyClass({
    decision,
    toolAction,
    goalState,
    escalation,
    serviceConfidence,
    relationshipData,
    eventPlan,
    mutation
}) {
    const reasons = [];
    const confidence = decision?.confidence_score || 0;
    const currentState = goalState?.current_state || 'new_lead';
    const toolName = toolAction?.name || 'reply_only';
    const hasEscalation = escalation?.needs_escalation || false;
    const svcStatus = serviceConfidence?.service_detection_status || 'unknown';

    // ═══════════════════════════════════════════════════
    // BLOCKED — hard blockers, never auto-send
    // ═══════════════════════════════════════════════════

    // 1. Critically low confidence
    if (confidence < 40) {
        reasons.push(`confidence_critical: ${confidence}%`);
        return { safetyClass: 'blocked_autoreply', reasons };
    }

    // 2. Dangerous tools
    const BLOCKED_TOOLS = ['confirm_booking_from_ai_plan'];
    if (BLOCKED_TOOLS.includes(toolName)) {
        reasons.push(`blocked_tool: ${toolName}`);
        return { safetyClass: 'blocked_autoreply', reasons };
    }

    // 3. Context insufficient — no reply generated
    if (!decision?.can_auto_reply && decision?.needs_human_review) {
        reasons.push('llm_requires_human');
        return { safetyClass: 'blocked_autoreply', reasons };
    }

    // ═══════════════════════════════════════════════════
    // NEEDS REVIEW — operator should check first
    // ═══════════════════════════════════════════════════

    // 4. Escalation triggered (sentiment, policy, complexity)
    if (hasEscalation) {
        reasons.push(`escalation: ${escalation.escalation_type}`);
    }

    // 5. Commercial tools
    const REVIEW_TOOLS = ['generate_quote_draft', 'archive_plan'];
    if (REVIEW_TOOLS.includes(toolName)) {
        reasons.push(`commercial_tool: ${toolName}`);
    }

    // 6. Confidence below safe threshold
    if (confidence < AI_SAFE_AUTOREPLY_MIN_CONFIDENCE) {
        reasons.push(`confidence_low: ${confidence}% < ${AI_SAFE_AUTOREPLY_MIN_CONFIDENCE}%`);
    }

    // 7. Goal state not in allowed stages
    if (!AI_AUTOREPLY_ALLOWED_STAGES.includes(currentState)) {
        reasons.push(`stage_not_allowed: ${currentState}`);
    }

    // 8. Tool not in allowed tools
    if (!AI_AUTOREPLY_ALLOWED_TOOLS.includes(toolName)) {
        reasons.push(`tool_not_allowed: ${toolName}`);
    }

    // 9. Active booking + modification detected
    if (relationshipData?.hasActiveBooking && mutation?.mutation_type !== 'no_mutation') {
        reasons.push('active_booking_mutation');
    }

    // 10. Service ambiguity persistent
    if (svcStatus === 'ambiguous' && (serviceConfidence?.ambiguous_services?.length || 0) > 2) {
        reasons.push(`service_ambiguity: ${serviceConfidence.ambiguous_services.length} ambiguous`);
    }

    // 11. Event plan is operator-locked
    if (eventPlan?.operator_locked) {
        reasons.push('plan_operator_locked');
    }

    // 12. Handoff requested
    if (toolName === 'handoff_to_operator') {
        reasons.push('handoff_requested');
    }

    // If any review reason found, classify as needs_review
    if (reasons.length > 0) {
        return { safetyClass: 'needs_operator_review', reasons };
    }

    // ═══════════════════════════════════════════════════
    // SAFE — all checks passed
    // ═══════════════════════════════════════════════════
    reasons.push('all_checks_passed');
    return { safetyClass: 'safe_autoreply_allowed', reasons };
}
