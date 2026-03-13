/**
 * Event Plan Evaluator — Business-Real Edition
 *
 * Pure logic — evaluates completeness, readiness, and missing fields
 * for an event plan. Includes commercial closing fields.
 * No DB calls.
 */

/**
 * Evaluate event plan completeness and readiness.
 * Three levels: recommendation, quote, booking.
 *
 * @param {object} plan - ai_event_plans row
 * @returns {object} evaluation result
 */
export function evaluateEventPlan(plan) {
    if (!plan) {
        return {
            missingFields: ['requested_services', 'event_date', 'location', 'children_count_estimate',
                'event_time', 'child_age', 'payment_method_preference', 'invoice_requested', 'advance_status'],
            confirmedFields: [],
            confidence: 0,
            readinessForRecommendation: false,
            readinessForQuote: false,
            readinessForBooking: false,
            completionPercent: 0,
            summary: 'Nu există plan de eveniment.'
        };
    }

    const services = plan.requested_services || [];
    const confirmedServices = plan.confirmed_services || [];

    // ══════════════════════════════════════════════
    // FIELD CHECKS — grouped by readiness level
    // ══════════════════════════════════════════════

    // Level 1: recommendation (can we suggest packages?)
    const recommendationFields = [
        { key: 'requested_services', filled: services.length > 0 },
        { key: 'event_date', filled: !!plan.event_date },
        { key: 'location', filled: !!plan.location }
    ];

    // Level 2: quote (can we generate a price proposal?)
    const quoteFields = [
        ...recommendationFields,
        { key: 'children_count_estimate', filled: !!plan.children_count_estimate },
        { key: 'event_time', filled: !!plan.event_time }
    ];

    // Level 3: booking (can we proceed to reservation?)
    const bookingFields = [
        ...quoteFields,
        { key: 'child_age', filled: !!plan.child_age },
        { key: 'selected_package', filled: !!plan.selected_package },
        { key: 'payment_method_preference', filled: !!plan.payment_method_preference && plan.payment_method_preference !== 'unknown' },
        { key: 'invoice_requested', filled: !!plan.invoice_requested && plan.invoice_requested !== 'unknown' },
        { key: 'advance_status', filled: !!plan.advance_status && plan.advance_status !== 'unknown' && plan.advance_status !== 'none' }
    ];

    // Optional useful fields (not blocking any readiness)
    const optionalFields = [
        { key: 'event_type', filled: !!plan.event_type },
        { key: 'venue_type', filled: !!plan.venue_type },
        { key: 'occasion', filled: !!plan.occasion },
        { key: 'adults_count_estimate', filled: !!plan.adults_count_estimate },
        { key: 'advance_amount', filled: !!plan.advance_amount },
        { key: 'billing_details_status', filled: plan.billing_details_status && plan.billing_details_status !== 'missing' },
        { key: 'payment_notes', filled: !!plan.payment_notes }
    ];

    // ══════════════════════════════════════════════
    // READINESS COMPUTATION
    // ══════════════════════════════════════════════

    const recFilled = recommendationFields.filter(f => f.filled);
    const readinessForRecommendation = recFilled.length === recommendationFields.length;

    const quoteFilled = quoteFields.filter(f => f.filled);
    const readinessForQuote = quoteFilled.length === quoteFields.length;

    const bookingFilled = bookingFields.filter(f => f.filled);
    const readinessForBooking = bookingFilled.length === bookingFields.length;

    // ══════════════════════════════════════════════
    // MISSING FIELDS — union of all unfilled fields
    // ══════════════════════════════════════════════
    const allChecks = [...bookingFields, ...optionalFields.filter(f => !f.filled && ['advance_amount', 'billing_details_status'].includes(f.key))];
    const uniqueKeys = new Set();
    const missingFields = [];
    const confirmedFields = [];

    for (const f of allChecks) {
        if (uniqueKeys.has(f.key)) continue;
        uniqueKeys.add(f.key);
        if (f.filled) confirmedFields.push(f.key);
        else missingFields.push(f.key);
    }

    // ══════════════════════════════════════════════
    // COMPLETION & CONFIDENCE
    // ══════════════════════════════════════════════
    const totalFields = bookingFields.length;
    const filledCount = bookingFields.filter(f => f.filled).length;
    const completionPercent = Math.round((filledCount / totalFields) * 100);

    let confidence = 10 + (filledCount * 8);
    if (confirmedServices.length > 0) confidence += 10;
    if (plan.selected_package) confidence += 10;
    if (plan.payment_method_preference && plan.payment_method_preference !== 'unknown') confidence += 5;
    confidence = Math.min(confidence, 100);

    // ══════════════════════════════════════════════
    // SUMMARY
    // ══════════════════════════════════════════════
    const parts = [];
    if (services.length > 0) parts.push(`Servicii: ${services.join(', ')}`);
    if (plan.event_date) parts.push(`Data: ${plan.event_date}`);
    if (plan.location) parts.push(`Locație: ${plan.location}`);
    if (plan.children_count_estimate) parts.push(`Copii: ~${plan.children_count_estimate}`);
    if (plan.child_age) parts.push(`Vârstă: ${plan.child_age}`);
    if (plan.payment_method_preference && plan.payment_method_preference !== 'unknown') {
        parts.push(`Plata: ${plan.payment_method_preference}`);
    }
    if (plan.advance_status && plan.advance_status !== 'unknown') {
        parts.push(`Avans: ${plan.advance_status}`);
    }
    if (missingFields.length > 0) parts.push(`Lipsă: ${missingFields.join(', ')}`);

    return {
        missingFields,
        confirmedFields,
        confidence,
        readinessForRecommendation,
        readinessForQuote,
        readinessForBooking,
        completionPercent,
        summary: parts.join(' | ') || 'Plan gol'
    };
}

/**
 * Merge LLM analysis output into event plan update fields.
 * Maps from the LLM's output to ai_event_plans columns.
 * Includes commercial closing field extraction.
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

    // ── Map event fields ──
    const animatorFields = analysis.service_requirements?.animator?.extracted_fields || {};
    
    // Merge animator specific fields into draft fallback
    const mergedSource = { ...draft, ...animatorFields };

    if (mergedSource.date && mergedSource.date !== 'null') updates.event_date = mergedSource.date;
    if (mergedSource.location && mergedSource.location !== 'null') updates.location = mergedSource.location;
    if (mergedSource.event_type && mergedSource.event_type !== 'null') updates.event_type = mergedSource.event_type;
    if (mergedSource.ora || mergedSource.ora_start) updates.event_time = mergedSource.ora || mergedSource.ora_start;
    if (mergedSource.interval_orar) updates.event_time = mergedSource.interval_orar;
    if (mergedSource.venue_type) updates.venue_type = mergedSource.venue_type;
    if (mergedSource.occasion || mergedSource.tip_eveniment) updates.occasion = mergedSource.occasion || mergedSource.tip_eveniment;

    // ── Children count (primary volume field) ──
    const childrenCount = mergedSource.numar_copii || mergedSource.children_count_estimate || mergedSource.nr_copii || mergedSource.guest_count;
    if (childrenCount) {
        const parsed = typeof childrenCount === 'number' ? childrenCount : Number.parseInt(String(childrenCount), 10);
        if (!Number.isNaN(parsed)) updates.children_count_estimate = parsed;
    }

    // ── Adults count (optional) ──
    const adultsCount = mergedSource.numar_adulti || mergedSource.adults_count_estimate;
    if (adultsCount) {
        const parsed = typeof adultsCount === 'number' ? adultsCount : Number.parseInt(String(adultsCount), 10);
        if (!Number.isNaN(parsed)) updates.adults_count_estimate = parsed;
    }

    // ── Child Name ──
    const childName = mergedSource.nume_copil || mergedSource.child_name || mergedSource.sarbatorit;
    if (childName && childName !== 'null') updates.child_name = childName;

    // ── Duration Hours ──
    const durationHours = mergedSource.durata_ore || mergedSource.duration_hours || mergedSource.ore;
    if (durationHours) {
        const parsed = typeof durationHours === 'number' ? durationHours : Number.parseInt(String(durationHours), 10);
        if (!Number.isNaN(parsed)) updates.duration_hours = parsed;
    }

    // ── Animator Count ──
    const animatorCount = mergedSource.nr_animatori || mergedSource.animator_count || mergedSource.personaje;
    if (animatorCount) {
        const parsed = typeof animatorCount === 'number' ? animatorCount : Number.parseInt(String(animatorCount), 10);
        if (!Number.isNaN(parsed)) updates.animator_count = parsed;
    }

    // ── Child age ──
    const childAge = mergedSource.varsta_copil || mergedSource.child_age;
    if (childAge) {
        const parsed = typeof childAge === 'number' ? childAge : Number.parseInt(String(childAge), 10);
        if (!Number.isNaN(parsed)) updates.child_age = parsed;
    }

    // ── Services — merge, don't replace ──
    if (services.length > 0) {
        const existingServices = existingPlan?.requested_services || [];
        const merged = [...new Set([...existingServices, ...services])];
        if (JSON.stringify(merged.sort()) !== JSON.stringify(existingServices.sort())) {
            updates.requested_services = merged;
        }
    }

    // ── Commercial closing fields ──
    const commercialData = analysis.commercial_closing || {};

    // Payment method
    const paymentMethod = commercialData.payment_method_preference || draft.payment_method;
    if (paymentMethod && ['cash', 'card', 'transfer', 'factura'].includes(paymentMethod)) {
        updates.payment_method_preference = paymentMethod;
    }

    // Invoice
    const invoiceReq = commercialData.invoice_requested ?? draft.invoice_requested;
    if (invoiceReq !== undefined && invoiceReq !== null) {
        if (invoiceReq === true || invoiceReq === 'true' || invoiceReq === 'da') updates.invoice_requested = 'true';
        else if (invoiceReq === false || invoiceReq === 'false' || invoiceReq === 'nu') updates.invoice_requested = 'false';
    }

    // Advance
    const advanceReq = commercialData.advance_required ?? draft.advance_required;
    if (advanceReq !== undefined && advanceReq !== null) {
        if (advanceReq === true || advanceReq === 'true' || advanceReq === 'da') updates.advance_required = 'true';
        else if (advanceReq === false || advanceReq === 'false' || advanceReq === 'nu') updates.advance_required = 'false';
    }

    const advanceStatus = commercialData.advance_status || draft.advance_status;
    if (advanceStatus && ['none', 'requested', 'promised', 'paid', 'not_required'].includes(advanceStatus)) {
        updates.advance_status = advanceStatus;
    }

    const advanceAmount = commercialData.advance_amount || draft.advance_amount;
    if (advanceAmount) {
        const parsed = typeof advanceAmount === 'number' ? advanceAmount : Number.parseInt(String(advanceAmount), 10);
        if (!Number.isNaN(parsed)) updates.advance_amount = parsed;
    }

    // Billing
    const billingStatus = commercialData.billing_details_status || draft.billing_details_status;
    if (billingStatus && ['missing', 'partial', 'complete', 'not_needed'].includes(billingStatus)) {
        updates.billing_details_status = billingStatus;
    }

    const paymentNotes = commercialData.payment_notes || draft.payment_notes;
    if (paymentNotes && paymentNotes !== 'null') updates.payment_notes = paymentNotes;

    // ── Budget signals ──
    const intent = analysis.conversation_state?.current_intent?.toLowerCase() || '';
    if (/buget|ieftin|scump|cost/i.test(intent)) {
        if (/ieftin|mic|minim|redus/i.test(intent)) updates.budget_signal = 'cheap';
        else if (/scump|premium|lux/i.test(intent)) updates.budget_signal = 'premium';
        else updates.budget_signal = 'flexible';
    }

    return updates;
}
