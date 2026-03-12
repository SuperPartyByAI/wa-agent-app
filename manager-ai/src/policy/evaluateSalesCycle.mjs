import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } from '../config/env.mjs';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const CLOSED_STAGES = ['completed', 'paid'];
const ACTIVE_STAGES = ['booked', 'confirmed', 'coordination'];

/**
 * Evaluates the sales cycle status for a conversation.
 * Determines if a returning client on an old thread should be eligible
 * for auto-reply based on whether the previous cycle is closed and
 * the current message represents a new request.
 *
 * @param {object} params
 * @param {string} params.conversationId
 * @param {string} params.currentStage     - from DB ai_conversation_state
 * @param {object} params.llmSalesCycle    - from LLM analysis: { new_request_detected, same_event_or_new_event, cycle_notes }
 * @param {object} params.eventDraft       - existing event draft from DB
 * @param {string|null} params.lastHumanActivityAt
 * @param {string} params.conversationCreatedAt
 * @returns {object} { active_cycle_status, last_closed_cycle_at, new_request_detected, same_event_or_new_event, cycle_eligibility, cycle_reason }
 */
export async function evaluateSalesCycle({
    conversationId,
    currentStage,
    llmSalesCycle,
    eventDraft,
    lastHumanActivityAt,
    conversationCreatedAt
}) {
    const result = {
        active_cycle_status: 'none',
        last_closed_cycle_at: null,
        new_request_detected: false,
        same_event_or_new_event: 'no_previous',
        cycle_eligibility: 'eligible',
        cycle_reason: 'no_previous_cycle'
    };

    const stage = (currentStage || '').toLowerCase();

    // ── 1. Determine cycle status from DB stage ──
    if (CLOSED_STAGES.includes(stage)) {
        result.active_cycle_status = 'closed';
        // Use event draft updated_at as proxy for when cycle closed
        result.last_closed_cycle_at = eventDraft?.updated_at || null;
    } else if (ACTIVE_STAGES.includes(stage)) {
        result.active_cycle_status = 'active';
    } else if (stage === 'lead' || stage === 'qualifying' || stage === 'quoting') {
        // Early stages — could be active exploration or stale
        // Check if there was recent human activity
        if (lastHumanActivityAt) {
            const humanDate = new Date(lastHumanActivityAt);
            const daysSinceHuman = (Date.now() - humanDate.getTime()) / (1000 * 60 * 60 * 24);
            if (daysSinceHuman > 7) {
                // Stale early-stage conversation — treat as closed/inactive
                result.active_cycle_status = 'closed';
                result.last_closed_cycle_at = lastHumanActivityAt;
            } else {
                result.active_cycle_status = 'active';
            }
        } else {
            // No human activity at all — no active cycle
            result.active_cycle_status = 'none';
        }
    } else {
        // Unknown or no stage — no active cycle
        result.active_cycle_status = 'none';
    }

    // ── 2. Incorporate LLM cycle detection ──
    const llmCycle = llmSalesCycle || {};
    result.new_request_detected = !!llmCycle.new_request_detected;
    result.same_event_or_new_event = llmCycle.same_event_or_new_event || 'no_previous';

    // ── 3. Decision matrix ──

    // Case A: No previous cycle → eligible (new lead or fresh thread)
    if (result.active_cycle_status === 'none') {
        result.cycle_eligibility = 'eligible';
        result.cycle_reason = 'no_previous_cycle';
        return result;
    }

    // Case B: Closed cycle + new event detected → eligible (returning client)
    if (result.active_cycle_status === 'closed' && result.same_event_or_new_event === 'new_event') {
        result.cycle_eligibility = 'eligible';
        result.cycle_reason = 'closed_cycle_new_event';
        return result;
    }

    // Case C: Closed cycle + LLM says new request but not sure about event
    if (result.active_cycle_status === 'closed' && result.new_request_detected) {
        result.cycle_eligibility = 'eligible';
        result.cycle_reason = 'closed_cycle_new_request';
        return result;
    }

    // Case D: Closed cycle + no new request detected (could be follow-up on old)
    if (result.active_cycle_status === 'closed' && !result.new_request_detected) {
        // Closed cycle, no new intent — could be post-event inquiry. Allow with review.
        result.cycle_eligibility = 'review';
        result.cycle_reason = 'closed_cycle_no_new_request';
        return result;
    }

    // Case E: Active cycle + same event → blocked
    if (result.active_cycle_status === 'active' && result.same_event_or_new_event === 'same_event') {
        result.cycle_eligibility = 'blocked';
        result.cycle_reason = 'active_cycle_same_event';
        return result;
    }

    // Case F: Active cycle + new event detected → allow with review (could be complex)
    if (result.active_cycle_status === 'active' && result.same_event_or_new_event === 'new_event') {
        result.cycle_eligibility = 'review';
        result.cycle_reason = 'active_cycle_new_event_needs_review';
        return result;
    }

    // Case G: Active cycle + ambiguous → allow (client is actively messaging, let shouldReplyNow handle safety)
    if (result.active_cycle_status === 'active') {
        result.cycle_eligibility = 'eligible';
        result.cycle_reason = 'active_cycle_client_messaging';
        return result;
    }

    // Case H: Ambiguous detection → review
    if (result.same_event_or_new_event === 'ambiguous') {
        result.cycle_eligibility = 'review';
        result.cycle_reason = 'ambiguous_cycle_detection';
        return result;
    }

    // Default fallback
    result.cycle_eligibility = 'review';
    result.cycle_reason = 'unclassified_cycle';
    return result;
}
