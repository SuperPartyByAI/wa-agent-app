import { AI_WAVE2_MIN_CONFIDENCE, AI_WAVE2_ALLOWED_STAGES_LIST, AI_WAVE2_ENABLED } from '../config/env.mjs';

/**
 * Wave 2 Eligibility Engine — Phase 5
 * 
 * 12-check guard for update_event_plan autoreply.
 * Only allows safe fields on clear identity with no conflicts.
 */

// Fields allowed for Wave 2 auto-update
const WAVE2_SAFE_FIELDS = [
    'event_date', 'event_time', 'location', 'children_count_estimate',
    'child_name', 'duration_hours', 'animator_count', 'selected_package',
    'payment_method_preference', 'invoice_requested', 'advance_status'
];

// Tools NEVER allowed in Wave 2 autoreply
const WAVE2_BLOCKED_TOOLS = [
    'confirm_booking_from_ai_plan', 'archive_plan', 'handoff_to_operator'
];

/**
 * Check if an update_event_plan action is eligible for Wave 2 autoreply.
 * 
 * @param {object} params
 * @returns {{ eligible: boolean, blockers: string[], safeFields: string[], unsafeFields: string[] }}
 */
export function isWave2Eligible({
    safetyClass,
    toolAction,
    decision,
    goalState,
    escalation,
    eventPlan,
    memoryConflict,
    relationshipData,
    ambiguityDetected = false,
    identityUncertain = false,
    clarificationNeeded = false
}) {
    const blockers = [];
    const toolName = toolAction?.name || toolAction;
    const args = toolAction?.arguments || {};

    // 1. Wave 2 must be enabled
    if (!AI_WAVE2_ENABLED) {
        blockers.push('wave2_disabled');
    }

    // 2. Safety class must be compatible
    if (safetyClass !== 'safe_autoreply_allowed' && safetyClass !== 'needs_operator_review') {
        blockers.push(`safety_class: ${safetyClass}`);
    }

    // 3. Tool must be exactly update_event_plan
    if (toolName !== 'update_event_plan') {
        blockers.push(`tool_not_wave2: ${toolName}`);
    }

    // Block dangerous tools
    if (WAVE2_BLOCKED_TOOLS.includes(toolName)) {
        blockers.push(`tool_blocked: ${toolName}`);
    }

    // 4. Confidence must meet Wave 2 threshold (higher than Wave 1)
    if (decision?.confidence_score < AI_WAVE2_MIN_CONFIDENCE) {
        blockers.push(`confidence_low: ${decision?.confidence_score} < ${AI_WAVE2_MIN_CONFIDENCE}`);
    }

    // 5. Stage must be in allowed list
    const stage = goalState?.current_state || decision?.conversation_stage;
    if (stage && !AI_WAVE2_ALLOWED_STAGES_LIST.includes(stage)) {
        blockers.push(`stage_not_allowed: ${stage}`);
    }

    // 6. No ambiguity
    if (ambiguityDetected) {
        blockers.push('ambiguity_detected');
    }

    // 7. No identity uncertainty
    if (identityUncertain) {
        blockers.push('identity_uncertain');
    }

    // 8. No active booking conflict
    if (relationshipData?.hasActiveBooking) {
        blockers.push('active_booking');
    }

    // 9. No operator lock
    if (eventPlan?.operator_locked) {
        blockers.push('operator_locked');
    }

    // 10. No archived/cancelled plan
    if (eventPlan && ['archived', 'cancelled', 'hidden'].includes(eventPlan.status)) {
        blockers.push(`plan_status: ${eventPlan.status}`);
    }

    // 11. No memory conflicts (critical/high)
    if (memoryConflict?.hasConflict && ['critical', 'high'].includes(memoryConflict.severity)) {
        blockers.push(`memory_conflict: ${memoryConflict.severity} (${memoryConflict.conflicts.map(c => c.type).join(', ')})`);
    }

    // 12. No unresolved clarification
    if (clarificationNeeded) {
        blockers.push('clarification_needed');
    }

    // 13. No escalation
    if (escalation?.needs_escalation) {
        blockers.push(`escalation: ${escalation.escalation_reason}`);
    }

    // Validate proposed fields — only safe fields allowed
    const proposedFields = Object.keys(args).filter(k => args[k] !== undefined && args[k] !== null);
    const safeFields = proposedFields.filter(f => WAVE2_SAFE_FIELDS.includes(f));
    const unsafeFields = proposedFields.filter(f => !WAVE2_SAFE_FIELDS.includes(f));

    if (unsafeFields.length > 0) {
        blockers.push(`unsafe_fields: ${unsafeFields.join(', ')}`);
    }

    return {
        eligible: blockers.length === 0,
        blockers,
        safeFields,
        unsafeFields,
        proposed_field_count: proposedFields.length
    };
}
