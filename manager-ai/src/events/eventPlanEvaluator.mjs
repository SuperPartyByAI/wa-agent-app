/**
 * Event Plan Evaluator
 *
 * Pure logic — evaluates completeness, readiness, and missing fields
 * for an event plan. No DB calls.
 */

/**
 * Evaluate event plan completeness and readiness.
 *
 * @param {object} plan - ai_event_plans row
 * @returns {object} evaluation result
 */
export function evaluateEventPlan(plan) {
    if (!plan) {
        return {
            missingFields: ['event_date', 'location', 'guest_count', 'event_time', 'requested_services'],
            confirmedFields: [],
            confidence: 0,
            readinessForQuote: false,
            readinessForBooking: false,
            completionPercent: 0,
            summary: 'Nu există plan de eveniment.'
        };
    }

    const services = plan.requested_services || [];
    const confirmedServices = plan.confirmed_services || [];

    // ── Define required fields ──
    const fieldChecks = [
        { key: 'requested_services', label: 'Servicii', filled: services.length > 0 },
        { key: 'event_date', label: 'Data', filled: !!plan.event_date },
        { key: 'location', label: 'Locația', filled: !!plan.location },
        { key: 'guest_count', label: 'Nr. invitați', filled: !!plan.guest_count },
        { key: 'event_time', label: 'Ora', filled: !!plan.event_time }
    ];

    // ── Optional but useful fields ──
    const optionalFields = [
        { key: 'child_age', label: 'Vârsta copilului', filled: !!plan.child_age },
        { key: 'event_type', label: 'Tip eveniment', filled: !!plan.event_type },
        { key: 'venue_type', label: 'Tip locație', filled: !!plan.venue_type },
        { key: 'occasion', label: 'Ocazie', filled: !!plan.occasion }
    ];

    const missingFields = fieldChecks.filter(f => !f.filled).map(f => f.key);
    const confirmedFields = fieldChecks.filter(f => f.filled).map(f => f.key);
    const missingOptional = optionalFields.filter(f => !f.filled).map(f => f.key);

    const totalRequired = fieldChecks.length;
    const filledRequired = confirmedFields.length;
    const completionPercent = Math.round((filledRequired / totalRequired) * 100);

    // ── Readiness for quote ──
    // Minimum: services + date + location
    const readinessForQuote = services.length > 0 && !!plan.event_date && !!plan.location;

    // ── Readiness for booking ──
    // Minimum: all required fields + package selected
    const readinessForBooking = readinessForQuote
        && !!plan.guest_count
        && !!plan.event_time
        && !!plan.selected_package;

    // ── Confidence ──
    let confidence = 10 + (filledRequired * 15);
    if (confirmedServices.length > 0) confidence += 10;
    if (plan.selected_package) confidence += 10;
    confidence = Math.min(confidence, 100);

    // ── Summary for operator ──
    const parts = [];
    if (services.length > 0) parts.push(`Servicii: ${services.join(', ')}`);
    if (plan.event_date) parts.push(`Data: ${plan.event_date}`);
    if (plan.location) parts.push(`Locație: ${plan.location}`);
    if (plan.guest_count) parts.push(`Invitați: ${plan.guest_count}`);
    if (missingFields.length > 0) parts.push(`Lipsă: ${missingFields.join(', ')}`);

    return {
        missingFields,
        confirmedFields,
        missingOptional,
        confidence,
        readinessForQuote,
        readinessForBooking,
        completionPercent,
        summary: parts.join(' | ') || 'Plan gol'
    };
}

/**
 * Merge LLM analysis output into event plan update fields.
 * Maps from the LLM's event_draft format to ai_event_plans columns.
 *
 * @param {object} analysis - LLM output
 * @param {object} existingPlan - current event plan
 * @returns {object} updates to apply to event plan
 */
export function extractEventPlanUpdates(analysis, existingPlan) {
    if (!analysis) return {};

    const updates = {};
    const draft = analysis.event_draft?.structured_data || {};
    const services = analysis.selected_services || [];

    // ── Map LLM fields → Event Plan columns ──
    if (draft.date && draft.date !== 'null') updates.event_date = draft.date;
    if (draft.location && draft.location !== 'null') updates.location = draft.location;
    if (draft.event_type && draft.event_type !== 'null') updates.event_type = draft.event_type;
    if (draft.ora || draft.ora_start) updates.event_time = draft.ora || draft.ora_start;
    if (draft.interval_orar) updates.event_time = draft.interval_orar;
    if (draft.venue_type) updates.venue_type = draft.venue_type;

    // ── Guest count (multiple possible field names from LLM) ──
    const guestCount = draft.numar_copii || draft.numar_invitati || draft.nr_copii || draft.guest_count;
    if (guestCount) {
        const parsed = typeof guestCount === 'number' ? guestCount : Number.parseInt(String(guestCount), 10);
        if (!Number.isNaN(parsed)) updates.guest_count = parsed;
    }

    // ── Child age ──
    const childAge = draft.varsta_copil || draft.child_age;
    if (childAge) {
        const parsed = typeof childAge === 'number' ? childAge : Number.parseInt(String(childAge), 10);
        if (!Number.isNaN(parsed)) updates.child_age = parsed;
    }

    // ── Occasion ──
    if (draft.occasion || draft.tip_eveniment) updates.occasion = draft.occasion || draft.tip_eveniment;

    // ── Services — merge with existing, don't replace ──
    if (services.length > 0) {
        const existingServices = existingPlan?.requested_services || [];
        const merged = [...new Set([...existingServices, ...services])];
        if (JSON.stringify(merged.sort()) !== JSON.stringify(existingServices.sort())) {
            updates.requested_services = merged;
        }
    }

    // ── Budget signals ──
    const intent = analysis.conversation_state?.current_intent?.toLowerCase() || '';
    if (/buget|ieftin|scump|cost/i.test(intent)) {
        if (/ieftin|mic|minim|redus/i.test(intent)) updates.budget_signal = 'cheap';
        else if (/scump|premium|lux/i.test(intent)) updates.budget_signal = 'premium';
        else updates.budget_signal = 'flexible';
    }

    return updates;
}
