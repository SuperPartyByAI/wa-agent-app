/**
 * Goal Transition Evaluator — Business-Real Edition
 *
 * Pure logic — determines if/when to transition between goal states
 * based on event plan completeness, services, commercial readiness.
 * No DB calls.
 */

/**
 * Evaluate whether the conversation should transition to a new goal state.
 *
 * @param {object} ctx
 * @param {string} ctx.currentState - current goal state
 * @param {object} ctx.eventPlan - ai_event_plans row
 * @param {object} ctx.analysis - LLM analysis output
 * @param {object} ctx.mutation - detected mutation
 * @param {object} ctx.services - { selected, confirmed, detection_status }
 * @param {boolean} ctx.isGreeting - whether the message is a greeting
 * @param {string} ctx.lastClientMessage - last client message text
 * @returns {{ shouldTransition: boolean, newState: string, from: string, reason: string, confidence: number }}
 */
export function evaluateGoalTransition(ctx) {
    const {
        currentState,
        eventPlan,
        analysis,
        mutation,
        services,
        isGreeting,
        lastClientMessage
    } = ctx;

    const selected = services?.selected || [];
    const msg = (lastClientMessage || '').toLowerCase();

    const result = { shouldTransition: false, newState: currentState, from: currentState, reason: '', confidence: 80 };

    // ── CANCEL detection (any state) ──
    if (mutation?.mutation_type === 'cancel_event' || /\b(anulez|anulam|renuntam|renunt|cancel)\b/i.test(msg)) {
        result.shouldTransition = true;
        result.newState = 'cancelled';
        result.reason = 'cancel_intent_detected';
        return result;
    }

    // ── ARCHIVE detection ──
    if (mutation?.mutation_type === 'archive_event') {
        result.shouldTransition = true;
        result.newState = 'archived';
        result.reason = 'archive_intent_detected';
        return result;
    }

    // ── State-specific transitions ──
    switch (currentState) {
        case 'new_lead':
            if (isGreeting && selected.length === 0) {
                result.shouldTransition = true;
                result.newState = 'greeting';
                result.reason = 'greeting_detected';
            } else if (selected.length > 0) {
                result.shouldTransition = true;
                result.newState = 'service_selection';
                result.reason = 'services_detected_immediately';
            }
            break;

        case 'greeting':
            if (selected.length > 0) {
                result.shouldTransition = true;
                result.newState = 'service_selection';
                result.reason = 'services_detected_after_greeting';
            } else if (msg.length > 10) {
                result.shouldTransition = true;
                result.newState = 'discovery';
                result.reason = 'client_described_needs';
            }
            break;

        case 'discovery':
            if (selected.length > 0) {
                result.shouldTransition = true;
                result.newState = 'service_selection';
                result.reason = 'services_identified_from_discovery';
            }
            break;

        case 'service_selection':
            if (eventPlan && (eventPlan.event_date || eventPlan.location || eventPlan.children_count_estimate)) {
                result.shouldTransition = true;
                result.newState = 'event_qualification';
                result.reason = 'event_details_started';
            }
            break;

        case 'event_qualification':
            if (eventPlan?.readiness_for_recommendation) {
                result.shouldTransition = true;
                result.newState = 'package_recommendation';
                result.reason = 'recommendation_ready';
            }
            break;

        case 'package_recommendation':
            if (eventPlan?.readiness_for_quote || eventPlan?.selected_package) {
                result.shouldTransition = true;
                result.newState = 'quotation_draft';
                result.reason = 'quote_ready_or_package_selected';
                result.confidence = 85;
            }
            break;

        case 'quotation_draft':
            if (/\b(trimite|send|da-mi|vezi)\b/i.test(msg)) {
                result.shouldTransition = true;
                result.newState = 'quotation_sent';
                result.reason = 'quote_send_requested';
            }
            break;

        case 'quotation_sent':
            if (/\b(confirm|accept|da|perfect|ok|merge|bun|super|gata)\b/i.test(msg)) {
                result.shouldTransition = true;
                // If commercial fields are complete, go to booking_ready
                if (eventPlan?.readiness_for_booking) {
                    result.newState = 'booking_ready';
                    result.reason = 'accepted_with_complete_commercial';
                } else {
                    result.newState = 'booking_pending';
                    result.reason = 'accepted_needs_commercial_details';
                }
            } else if (/\b(scump|mult|ieftin|reduc|discount|alt pret|negoci|obiect)\b/i.test(msg)) {
                result.shouldTransition = true;
                result.newState = 'objection_handling';
                result.reason = 'objection_detected';
            }
            break;

        case 'objection_handling':
            if (/\b(ok|accept|bun|merge|da|perfect)\b/i.test(msg)) {
                result.shouldTransition = true;
                result.newState = 'booking_pending';
                result.reason = 'objection_resolved';
            }
            break;

        case 'booking_pending':
            // Transition to booking_ready when all commercial fields are filled
            if (eventPlan?.readiness_for_booking) {
                result.shouldTransition = true;
                result.newState = 'booking_ready';
                result.reason = 'commercial_details_complete';
                result.confidence = 90;
            }
            break;

        case 'booking_ready':
            if (/\b(confirm|finaliz|gata|perfect|da)\b/i.test(msg)) {
                result.shouldTransition = true;
                result.newState = 'booking_confirmed';
                result.reason = 'booking_confirmed_by_client';
                result.confidence = 95;
            }
            break;

        case 'booking_confirmed':
            if (/\b(reprogramr|amân|schimb.*dat|alt.*dat)\b/i.test(msg)) {
                result.shouldTransition = true;
                result.newState = 'reschedule_pending';
                result.reason = 'reschedule_requested';
            }
            break;

        case 'reschedule_pending':
            if (eventPlan?.event_date) {
                result.shouldTransition = true;
                result.newState = 'booking_pending';
                result.reason = 'new_date_provided';
            }
            break;

        case 'cancelled':
            // Can be reactivated if client re-engages
            if (selected.length > 0 || msg.length > 20) {
                result.shouldTransition = true;
                result.newState = 'discovery';
                result.reason = 'client_re_engaged_after_cancel';
            }
            break;

        case 'archived':
            if (selected.length > 0 || msg.length > 20) {
                result.shouldTransition = true;
                result.newState = 'discovery';
                result.reason = 'client_re_engaged_after_archive';
            }
            break;
    }

    return result;
}
