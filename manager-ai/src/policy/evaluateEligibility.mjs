import { AI_AUTOREPLY_ENABLED, AI_AUTOREPLY_CUTOFF, BLOCKED_STAGES, MIN_AUTOREPLY_CONFIDENCE } from '../config/env.mjs';

/**
 * Evaluates whether a conversation is eligible for AI auto-reply.
 * Returns { eligible: boolean, reason: string }
 *
 * @param {object} params
 * @param {object} params.decision            - LLM decision object
 * @param {string} params.conversationStage   - current conversation stage from AI state
 * @param {string} params.conversationCreatedAt - when conversation was created (ISO string)
 * @param {string|null} params.lastHumanActivityAt - last human agent message timestamp
 * @param {boolean} params.hasExistingDraft   - whether an event draft already existed before cutoff
 * @param {string|null} params.lastInboundMessageAt - timestamp of the most recent inbound (client) message
 */
export function evaluateEligibility({
    decision,
    conversationStage,
    conversationCreatedAt,
    lastHumanActivityAt,
    hasExistingDraft,
    lastInboundMessageAt
}) {
    // 1. Global kill switch
    if (!AI_AUTOREPLY_ENABLED) {
        return { eligible: false, reason: 'global_switch_off' };
    }

    // 2. Activation cutoff
    //    - Primary: conversation created after cutoff → eligible
    //    - Secondary: last inbound message after cutoff → conversation reactivated, eligible
    //    This handles transports (whts-up) that reuse old conversation IDs for returning numbers.
    if (AI_AUTOREPLY_CUTOFF) {
        const cutoffDate = new Date(AI_AUTOREPLY_CUTOFF);
        const convDate = new Date(conversationCreatedAt);
        const inboundDate = lastInboundMessageAt ? new Date(lastInboundMessageAt) : null;

        const convAfterCutoff = convDate >= cutoffDate;
        const inboundAfterCutoff = inboundDate && inboundDate >= cutoffDate;

        if (!convAfterCutoff && !inboundAfterCutoff) {
            return { eligible: false, reason: 'blocked_below_cutoff' };
        }
    }

    // 3. Stage blocking — already booked/confirmed/paid/completed conversations
    const effectiveStage = conversationStage || decision?.conversation_stage || 'unknown';
    if (BLOCKED_STAGES.includes(effectiveStage.toLowerCase())) {
        return { eligible: false, reason: `blocked_stage_${effectiveStage}` };
    }

    // 4. Legacy/manual-managed — if there was human agent activity before cutoff
    if (AI_AUTOREPLY_CUTOFF && lastHumanActivityAt) {
        const cutoffDate = new Date(AI_AUTOREPLY_CUTOFF);
        const humanDate = new Date(lastHumanActivityAt);
        if (humanDate < cutoffDate) {
            return { eligible: false, reason: 'blocked_manual_legacy' };
        }
    }

    // 5. Existing mature draft created before cutoff
    if (AI_AUTOREPLY_CUTOFF && hasExistingDraft) {
        return { eligible: false, reason: 'blocked_existing_draft' };
    }

    // 6. LLM decision checks
    if (!decision?.can_auto_reply) {
        return { eligible: false, reason: 'blocked_by_decision' };
    }

    if (decision?.needs_human_review) {
        return { eligible: false, reason: 'blocked_needs_review' };
    }

    if ((decision?.confidence_score || 0) < MIN_AUTOREPLY_CONFIDENCE) {
        return { eligible: false, reason: 'blocked_low_confidence' };
    }

    if (decision?.escalation_reason) {
        return { eligible: false, reason: `blocked_escalation` };
    }

    // All checks passed
    return { eligible: true, reason: 'allowed' };
}
