/**
 * Goal Transition Evaluator
 *
 * Pure logic — no DB calls. Determines if/how the goal state should transition
 * based on event plan, LLM analysis, mutation, and service data.
 */

/**
 * Evaluate whether the goal state should transition.
 *
 * @param {object} params
 * @param {string} params.currentState    - current goal state key
 * @param {object} params.eventPlan       - from loadOrCreateEventPlan()
 * @param {object} params.analysis        - LLM analysis output
 * @param {object} params.mutation        - from detectEventMutation()
 * @param {object} params.services        - { selected: [], confirmed: [], detection_status }
 * @param {boolean} params.isGreeting     - true if last message is a simple greeting
 * @param {string} params.lastClientMessage - raw text of last client message
 * @returns {{ shouldTransition: boolean, newState: string, reason: string, confidence: number }}
 */
export function evaluateGoalTransition({
    currentState,
    eventPlan,
    analysis,
    mutation,
    services,
    isGreeting = false,
    lastClientMessage = ''
}) {
    const result = { shouldTransition: false, newState: currentState, reason: 'no_change', confidence: 80 };
    const msg = lastClientMessage.toLowerCase();

    // ── Cancellation intent ──
    if (mutation?.mutation_type === 'cancel_event') {
        return { shouldTransition: true, newState: 'cancelled', reason: 'cancel_intent_detected', confidence: 90 };
    }

    // ── Reactivation from cancelled ──
    if (currentState === 'cancelled' && mutation?.mutation_type === 'reactivate_event') {
        return { shouldTransition: true, newState: 'service_selection', reason: 'reactivation_after_cancel', confidence: 85 };
    }

    // ── Confirmation / booking intent ──
    const bookingSignals = /\b(confirm[aă]m?|accept[aă]m?|da,?\s*(e\s*)?bine|sunt de acord|merge|perfect,?\s*confirm|pl[aă]tesc|vreau s[aă] rezerv|rezerv[aă]m)\b/i;
    if (bookingSignals.test(msg) && ['quotation_sent', 'objection_handling'].includes(currentState)) {
        return { shouldTransition: true, newState: 'booking_pending', reason: 'client_accepted_quote', confidence: 85 };
    }
    if (bookingSignals.test(msg) && currentState === 'booking_pending') {
        return { shouldTransition: true, newState: 'booking_confirmed', reason: 'client_confirmed_booking', confidence: 90 };
    }

    // ── Objection / price negotiation ──
    const objectionSignals = /\b(scump|mult|nu-mi permit|alt pre[tț]|reduc|discount|ofert[aă] mai|prea mare|nu [eî]mi convine|mai ieftin)\b/i;
    if (objectionSignals.test(msg) && ['quotation_sent', 'package_recommendation', 'quotation_draft'].includes(currentState)) {
        return { shouldTransition: true, newState: 'objection_handling', reason: 'price_objection_detected', confidence: 80 };
    }

    // ── Reschedule intent ──
    const rescheduleSignals = /\b(mut[aă]m|reprogramez|schimb[aă]m? data|alt[aă] dat[aă]|amân[aă]m)\b/i;
    if (rescheduleSignals.test(msg) && ['booking_confirmed', 'booking_pending'].includes(currentState)) {
        return { shouldTransition: true, newState: 'reschedule_pending', reason: 'reschedule_intent', confidence: 80 };
    }

    // ── Quote request ──
    const quoteSignals = /\b(ofert[aă]|propunere|pre[tț].*total|c[aâ]t.*cost[aă].*tot|vreau ofert[aă]|trime[tț].*ofert)\b/i;
    if (quoteSignals.test(msg) && ['package_recommendation', 'event_qualification'].includes(currentState)) {
        if (eventPlan?.readiness_for_quote) {
            return { shouldTransition: true, newState: 'quotation_draft', reason: 'client_requested_quote_ready', confidence: 90 };
        }
        // Not ready yet — stay and collect more info
    }

    // ── State-specific forward transitions ──
    switch (currentState) {
        case 'new_lead':
            if (isGreeting) {
                return { shouldTransition: true, newState: 'greeting', reason: 'greeting_detected', confidence: 95 };
            }
            if (services?.selected?.length > 0) {
                return { shouldTransition: true, newState: 'service_selection', reason: 'services_detected_on_first_message', confidence: 85 };
            }
            return { shouldTransition: true, newState: 'discovery', reason: 'first_message_no_service', confidence: 80 };

        case 'greeting':
            if (services?.selected?.length > 0) {
                return { shouldTransition: true, newState: 'service_selection', reason: 'services_mentioned_after_greeting', confidence: 85 };
            }
            if (msg.length > 5 && !isGreeting) {
                return { shouldTransition: true, newState: 'discovery', reason: 'client_stated_intent', confidence: 75 };
            }
            break;

        case 'discovery':
            if (services?.selected?.length > 0) {
                return { shouldTransition: true, newState: 'service_selection', reason: 'services_detected', confidence: 85 };
            }
            break;

        case 'service_selection': {
            const hasDate = !!eventPlan?.event_date;
            const hasLocation = !!eventPlan?.location;
            const hasServices = (eventPlan?.requested_services?.length || services?.selected?.length || 0) > 0;
            if (hasServices && (hasDate || hasLocation)) {
                return { shouldTransition: true, newState: 'event_qualification', reason: 'event_details_started', confidence: 80 };
            }
            // Service confirmed explicitly
            if (services?.detection_status === 'confirmed') {
                return { shouldTransition: true, newState: 'event_qualification', reason: 'services_confirmed', confidence: 85 };
            }
            break;
        }

        case 'event_qualification':
            if (eventPlan?.readiness_for_quote) {
                return { shouldTransition: true, newState: 'package_recommendation', reason: 'ready_for_recommendation', confidence: 85 };
            }
            break;

        case 'package_recommendation':
            // If client selected a package
            if (eventPlan?.selected_package) {
                return { shouldTransition: true, newState: 'quotation_draft', reason: 'package_selected', confidence: 85 };
            }
            break;

        case 'quotation_draft':
            // Quote sent action handled elsewhere
            break;

        case 'reschedule_pending':
            if (eventPlan?.event_date && mutation?.mutation_type === 'change_date') {
                return { shouldTransition: true, newState: 'booking_pending', reason: 'new_date_set', confidence: 80 };
            }
            break;
    }

    return result;
}
