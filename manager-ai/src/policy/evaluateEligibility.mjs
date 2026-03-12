import { AI_AUTOREPLY_ENABLED, AI_AUTOREPLY_CUTOFF, BLOCKED_STAGES, MIN_AUTOREPLY_CONFIDENCE } from '../config/env.mjs';

/**
 * Evaluates whether a conversation is eligible for AI auto-reply.
 * Returns { eligible: boolean, reason: string }
 *
 * Layers:
 *  1. Global kill switch
 *  2. Activation cutoff (conversation + inbound message)
 *  3. Sales cycle + stage check (cycle-aware: closed cycle + new event → pass)
 *  4. Legacy/manual-managed (cycle-aware: closed cycle overrides legacy block)
 *  5. Existing draft (cycle-aware: closed cycle overrides draft block)
 *  6. LLM decision checks (can_auto_reply, needs_human_review, confidence, escalation)
 *
 * @param {object} params
 * @param {object} params.decision            - LLM decision object
 * @param {string} params.conversationStage   - current conversation stage from AI state
 * @param {string} params.conversationCreatedAt - when conversation was created (ISO string)
 * @param {string|null} params.lastHumanActivityAt - last human agent message timestamp
 * @param {boolean} params.hasExistingDraft   - whether an event draft already existed before cutoff
 * @param {string|null} params.lastInboundMessageAt - timestamp of the most recent inbound (client) message
 * @param {object|null} params.salesCycle     - from evaluateSalesCycle(): { cycle_eligibility, cycle_reason, ... }
 */
export function evaluateEligibility({
    decision,
    conversationStage,
    conversationCreatedAt,
    lastHumanActivityAt,
    hasExistingDraft,
    lastInboundMessageAt,
    salesCycle
}) {
    // 1. Global kill switch
    if (!AI_AUTOREPLY_ENABLED) {
        return { eligible: false, reason: 'global_switch_off' };
    }

    // 2. Activation cutoff
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

    // Determine if sales cycle says this thread is eligible despite being old
    const cycleAllows = salesCycle && salesCycle.cycle_eligibility === 'eligible';
    const cycleReview = salesCycle && salesCycle.cycle_eligibility === 'review';
    const cycleBlocked = salesCycle && salesCycle.cycle_eligibility === 'blocked';

    // 3. Stage blocking — cycle-aware
    const effectiveStage = conversationStage || decision?.conversation_stage || 'unknown';
    if (BLOCKED_STAGES.includes(effectiveStage.toLowerCase())) {
        if (cycleAllows) {
            // Cycle says closed + new event → override stage block
            // (e.g. stage is "completed" but client wants a new party)
            console.log(`[Eligibility] Stage ${effectiveStage} blocked, but cycle override: ${salesCycle.cycle_reason}`);
        } else if (cycleReview) {
            return { eligible: false, reason: 'cycle_review_on_blocked_stage' };
        } else {
            return { eligible: false, reason: `blocked_stage_${effectiveStage}` };
        }
    }

    // 4. Legacy/manual-managed — cycle-aware
    if (AI_AUTOREPLY_CUTOFF && lastHumanActivityAt) {
        const cutoffDate = new Date(AI_AUTOREPLY_CUTOFF);
        const humanDate = new Date(lastHumanActivityAt);
        if (humanDate < cutoffDate) {
            if (cycleAllows) {
                // Cycle says closed + new event → override manual legacy block
                console.log(`[Eligibility] Manual legacy blocked, but cycle override: ${salesCycle.cycle_reason}`);
            } else if (cycleReview) {
                return { eligible: false, reason: 'cycle_review_on_legacy' };
            } else {
                return { eligible: false, reason: 'blocked_manual_legacy' };
            }
        }
    }

    // 5. Existing mature draft — cycle-aware
    if (AI_AUTOREPLY_CUTOFF && hasExistingDraft) {
        if (cycleAllows) {
            console.log(`[Eligibility] Existing draft blocked, but cycle override: ${salesCycle.cycle_reason}`);
        } else if (cycleReview) {
            return { eligible: false, reason: 'cycle_review_on_draft' };
        } else {
            return { eligible: false, reason: 'blocked_existing_draft' };
        }
    }

    // 5.5 If cycle explicitly blocked (active cycle + same event)
    if (cycleBlocked) {
        return { eligible: false, reason: `blocked_active_cycle_${salesCycle.cycle_reason}` };
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
        return { eligible: false, reason: 'blocked_escalation' };
    }

    // All checks passed
    return { eligible: true, reason: 'allowed' };
}
