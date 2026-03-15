/**
 * Next Best Action Engine — Business-Real Edition
 *
 * Determines the AI's optimal next action based on:
 * - Goal state
 * - Event plan completeness & readiness
 * - Commercial closing fields (payment/invoice/advance)
 * - Quote status
 * - KB matches
 * - Human takeover / escalation
 *
 * Pure logic — no DB calls.
 */

/**
 * Priority order for missing fields when calculating next action.
 * Fields asked first are more impactful for the sales flow.
 */
const FIELD_PRIORITY = [
    { key: 'requested_services', action: 'discover_services', question: 'Ce servicii vă interesează?' },
    { key: 'event_date', action: 'ask_event_date', question: 'Pentru ce dată doriți?' },
    { key: 'location', action: 'ask_location', question: 'Unde va fi evenimentul?' },
    { key: 'children_count_estimate', action: 'ask_children_count', question: 'Cam câți copii vor fi la petrecere?' },
    { key: 'child_age', action: 'ask_child_age', question: 'Ce vârstă are copilul/sărbătoritul?' },
    { key: 'event_time', action: 'ask_event_time', question: 'La ce oră ar fi evenimentul?' },
    { key: 'selected_package', action: 'recommend_packages', question: 'Doriți să vedeți pachetele disponibile?' },
    { key: 'payment_method_preference', action: 'clarify_payment_method', question: 'Cum preferați să faceți plata? (cash/card/transfer)' },
    { key: 'invoice_requested', action: 'ask_invoice_needed', question: 'Doriți factură?' },
    { key: 'advance_status', action: 'request_advance_confirmation', question: 'Vom avea nevoie de un avans pentru confirmare. Este ok?' }
];

/**
 * Evaluate next best action.
 *
 * @param {object} ctx
 * @param {object} ctx.goalState - { current_state, ... }
 * @param {object} ctx.eventPlan - ai_event_plans row
 * @param {object} ctx.quoteState - latest quote (if any)
 * @param {object} ctx.kbMatch - KB match result (if any)
 * @param {object} ctx.escalation - { needs_escalation, ... }
 * @param {boolean} ctx.humanTakeover - whether operator has taken over
 * @param {object} ctx.services - { selected, detection_status }
 * @returns {{ action: string, question: string, explanation: string, priority: string, commercialReadiness: object }}
 */
export function evaluateNextBestAction(ctx) {
    const { goalState, eventPlan, quoteState, kbMatch, escalation, humanTakeover, services, playbookKey } = ctx;
    const state = goalState?.current_state || 'new_lead';
    const missing = eventPlan?.missing_fields || [];

    // ── Priority overrides ──

    // 1. Human takeover — defer
    if (humanTakeover) {
        return {
            action: 'handoff_to_operator',
            question: '',
            explanation: 'Operatorul a preluat conversația. Oprește intervențiile automate prin delegare.',
            priority: 'override',
            commercialReadiness: buildCommercialReadiness(eventPlan)
        };
    }

    // 2. Escalation
    if (escalation?.needs_escalation) {
        return {
            action: 'handoff_to_operator',
            question: '',
            explanation: `Escalare necesară: ${escalation.escalation_reason}`,
            priority: 'override',
            commercialReadiness: buildCommercialReadiness(eventPlan)
        };
    }

    // 3. KB answer available with high confidence, unless overriden by a Playbook strategy
    if (kbMatch && kbMatch.score >= 0.75 && ['discovery', 'greeting', 'service_selection'].includes(state) && !playbookKey) {
        return {
            action: 'reply_only',
            question: '',
            explanation: `Oferă răspuns direct din KB: ${kbMatch.knowledgeKey || 'match'} fără a modifica datele.`,
            priority: 'high',
            commercialReadiness: buildCommercialReadiness(eventPlan)
        };
    }

    // ── State-specific actions ──

    // Greeting / New lead
    if (['new_lead', 'greeting'].includes(state)) {
        return {
            action: 'greet_and_discover',
            question: 'Suntem aici, cu ce vă putem ajuta azi? Deschidem planurile de petrecere?',
            explanation: 'Conversație la început — salutăm și descoperim nevoile.',
            priority: 'normal',
            commercialReadiness: buildCommercialReadiness(eventPlan)
        };
    }

    // Discovery
    if (state === 'discovery') {
        return {
            action: 'discover_services',
            question: 'Ce tip de eveniment planificați? Ce servicii v-ar interesa?',
            explanation: 'Încă nu știm ce vrea clientul — descoperim.',
            priority: 'normal',
            commercialReadiness: buildCommercialReadiness(eventPlan)
        };
    }

    // Service selection
    if (state === 'service_selection') {
        return {
            action: 'confirm_services',
            question: `Am înțeles că doriți: ${(services?.selected || []).join(', ')}. Corect?`,
            explanation: 'Servicii detectate, confirmăm cu clientul.',
            priority: 'normal',
            commercialReadiness: buildCommercialReadiness(eventPlan)
        };
    }

    // Event qualification — ask most important missing field
    if (state === 'event_qualification') {
        // Find highest priority missing field
        for (const fp of FIELD_PRIORITY) {
            if (missing.includes(fp.key) && fp.key !== 'selected_package' && fp.key !== 'payment_method_preference' && fp.key !== 'invoice_requested' && fp.key !== 'advance_status') {
                return {
                    action: 'update_event_plan',
                    question: fp.question,
                    explanation: `Lipsește ${fp.key} — folosește reply pentru a întreba clientul. Când răspunde folosește update_event_plan.`,
                    priority: 'normal',
                    commercialReadiness: buildCommercialReadiness(eventPlan)
                };
            }
        }
        // All event fields filled — recommend packages
        return {
            action: 'reply_only',
            question: 'Am toate detaliile. Doriți să vedeți pachetele disponibile?',
            explanation: 'Detalii eveniment complete — trecem la recomandare de pachete prin discuție.',
            priority: 'normal',
            commercialReadiness: buildCommercialReadiness(eventPlan)
        };
    }

    // Package recommendation
    if (state === 'package_recommendation') {
        return {
            action: 'recommend_packages',
            question: 'Vă recomandăm pachetele potrivite pentru evenimentul dumneavoastră.',
            explanation: 'Readiness_for_recommendation = true — prezentăm pachete.',
            priority: 'normal',
            commercialReadiness: buildCommercialReadiness(eventPlan)
        };
    }

    // Quotation draft
    if (state === 'quotation_draft') {
        if (quoteState?.status === 'draft') {
            return {
                action: 'reply_only',
                question: 'Am pregătit oferta. Doriți să o trimitem?',
                explanation: 'Ofertă draft gata — prezintă oferta clientului prin reply_only.',
                priority: 'high',
                commercialReadiness: buildCommercialReadiness(eventPlan)
            };
        }
        return {
            action: 'generate_quote_draft',
            question: '',
            explanation: 'Efectuează acțiunea generate_quote_draft folosind pachetul țintă.',
            priority: 'high',
            commercialReadiness: buildCommercialReadiness(eventPlan)
        };
    }

    // Quotation sent — wait
    if (state === 'quotation_sent') {
        return {
            action: 'wait_for_client_decision',
            question: '',
            explanation: 'Ofertă trimisă — așteptăm decizia clientului.',
            priority: 'low',
            commercialReadiness: buildCommercialReadiness(eventPlan)
        };
    }

    // Objection handling
    if (state === 'objection_handling') {
        return {
            action: 'handle_objection',
            question: '',
            explanation: 'Clientul are obiecții — procesăm și propunem alternativă.',
            priority: 'high',
            commercialReadiness: buildCommercialReadiness(eventPlan)
        };
    }

    // Booking pending — ask commercial fields
    if (state === 'booking_pending') {
        for (const fp of FIELD_PRIORITY) {
            if (missing.includes(fp.key) && ['payment_method_preference', 'invoice_requested', 'advance_status'].includes(fp.key)) {
                return {
                    action: 'update_event_plan',
                    question: fp.question,
                    explanation: `Detaliu comercial lipsă: ${fp.key}. Întreabă iar când răspunde actualizează planul cu update_event_plan.`,
                    priority: 'high',
                    commercialReadiness: buildCommercialReadiness(eventPlan)
                };
            }
        }
        return {
            action: 'reply_only',
            question: 'Avem toate detaliile comerciale. Confirmăm rezervarea?',
            explanation: 'Întreabă clientul dacă putem confirma ferm rezervarea și emite factura.',
            priority: 'high',
            commercialReadiness: buildCommercialReadiness(eventPlan)
        };
    }

    // Booking ready
    if (state === 'booking_ready') {
        return {
            action: 'confirm_booking_from_ai_plan',
            question: 'Totul este pregătit. Confirmăm rezervarea?',
            explanation: 'Toate detaliile comerciale OK. Așteaptă "DA"-ul final din partea clientului, apoi trimite acțiunea confirm_booking_from_ai_plan.',
            priority: 'high',
            commercialReadiness: buildCommercialReadiness(eventPlan)
        };
    }

    // Booking confirmed
    if (state === 'booking_confirmed') {
        return {
            action: 'reply_only',
            question: '',
            explanation: 'Rezervarea a fost deja confirmată și expediată. Spune la mulți ani/mulțumesc și închide.',
            priority: 'normal',
            commercialReadiness: buildCommercialReadiness(eventPlan)
        };
    }

    // Cancelled / archived / completed
    if (['cancelled', 'archived', 'completed'].includes(state)) {
        return {
            action: 'none',
            question: '',
            explanation: `Conversație ${state} — nicio acțiune necesară.`,
            priority: 'none',
            commercialReadiness: buildCommercialReadiness(eventPlan)
        };
    }

    // Default fallback
    return {
        action: 'handoff_to_operator',
        question: '',
        explanation: `Stare necunoscută: ${state}`,
        priority: 'low',
        commercialReadiness: buildCommercialReadiness(eventPlan)
    };
}

/**
 * Build a summary of commercial readiness from the event plan.
 */
function buildCommercialReadiness(plan) {
    if (!plan) return { paymentReady: false, invoiceReady: false, advanceReady: false };

    return {
        paymentReady: !!plan.payment_method_preference && plan.payment_method_preference !== 'unknown',
        invoiceReady: !!plan.invoice_requested && plan.invoice_requested !== 'unknown',
        advanceReady: !!plan.advance_status && !['unknown', 'none'].includes(plan.advance_status),
        advanceAmount: plan.advance_amount || null,
        billingStatus: plan.billing_details_status || 'missing',
        paymentNotes: plan.payment_notes || null
    };
}
