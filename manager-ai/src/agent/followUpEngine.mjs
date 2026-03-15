/**
 * FOLLOW-UP & HANDOFF ENGINE (Faza 5)
 *
 * Rules:
 * 1. 24h soft follow up after quote (oferta_trimisa)
 * 2. 72h final follow up
 * 3. block if human_takeover = true
 * 4. block if client said "revin eu" (do_not_followup = true)
 * 5. operator handoff for difficult cases (discount pressure, angry client, etc.)
 */

export const FOLLOWUP_TYPES = {
    SOFT: 'follow_up_soft',
    QUOTE_REMINDER: 'follow_up_quote_reminder',
    FINAL: 'follow_up_final'
};

export const HANDOFF_REASONS = {
    ANGRY_CLIENT: 'angry_client',
    DISCOUNT_PRESSURE: 'discount_pressure',
    COMPLEX_REQUEST: 'complex_request',
    HOT_LEAD_ACTION_REQUIRED: 'hot_lead_action_required',
    HIGH_AMBIGUITY: 'high_ambiguity'
};

/**
 * Checks if the lead should be forcefully handed off to an operator
 * based on the conversation context or recent messages.
 */
export function evaluateOperatorHandoff(context) {
    const { runtimeState, clientMessageText, missingMetrics } = context;
    if (!runtimeState) return null;

    if (runtimeState.human_takeover) return null; // Already taken over
    if (runtimeState.handoff_to_operator) return null; // Already handed off
    if (['won', 'lost', 'abandoned', 'operator_owned'].includes(runtimeState.closed_status)) return null;

    const txt = (clientMessageText || '').toLowerCase();

    // 1. Angry Client
    if (txt.includes('nesimti') || txt.includes('bataie de joc') || txt.includes('reclamatie') || txt.includes('anpc')) {
        return HANDOFF_REASONS.ANGRY_CLIENT;
    }

    // 2. Discount Pressure / Difficult negotiation
    // Example: client is constantly asking for bigger discounts
    if ((txt.includes('scump') || txt.includes('reducere')) && runtimeState.lead_state === 'oferta_trimisa') {
        const hasHadObjection = runtimeState.history ? runtimeState.history.includes('objection') : false;
        // If they still push for discount after we already tried objection handling playbook:
        if (hasHadObjection || txt.includes('vreau un pret mai bun') || txt.includes('in alta parte e mai ieftin') || txt.includes('alt pret')) {
             // We can trigger handoff
             return HANDOFF_REASONS.DISCOUNT_PRESSURE;
        }
    }

    // 3. Ambiguity overload / Complex requests
    if (txt.includes('vreau ceva cu totul special') || txt.includes('personalizat complet') || txt.includes('nu stiu exact, dar foarte elaborat')) {
        return HANDOFF_REASONS.COMPLEX_REQUEST;
    }

    return null; // No handoff needed right now
}

/**
 * Checks if the client explicitly said they will return later
 */
export function didClientSayReturn(clientMessageText) {
    const txt = (clientMessageText || '').toLowerCase();
    return txt.includes('revin eu') || txt.includes('lasa ca va scriu') || txt.includes('mai vorbim') || txt.includes('revin cu un mesaj') || txt.includes('te anunt eu') || txt.includes('va caut eu') || txt.includes('nu ma mai contactati');
}

/**
 * Evaluates the follow-up eligibility and type for a specific lead.
 * To be called by the Cron/Scheduler job.
 */
export function evaluateFollowUp(runtimeState) {
    if (!runtimeState) return null;

    // 1. HARD BLOCKS
    if (runtimeState.human_takeover) return null;
    if (runtimeState.handoff_to_operator) return null;
    if (runtimeState.do_not_followup) return null;
    if (['won', 'lost', 'abandoned', 'operator_owned'].includes(runtimeState.closed_status)) return null;

    // We only follow up if we are in a pending state, e.g. waiting for response
    // Or if oferta a fost trimisa si asteptam
    const isWaiting = ['asteapta_raspuns_client', 'oferta_trimisa', 'lead_nou', 'identificare_serviciu', 'colectare_date'].includes(runtimeState.lead_state);
    
    if (!isWaiting) return null;
    if (!runtimeState.follow_up_due_at) return null; // No deadline set

    const now = new Date();
    const dueAt = new Date(runtimeState.follow_up_due_at);

    if (now < dueAt) return null; // Not time yet

    // It's time! Determine which follow up
    const count = runtimeState.followup_count || 0;

    if (count === 0) {
        // First follow-up
        return runtimeState.lead_state === 'oferta_trimisa' ? FOLLOWUP_TYPES.QUOTE_REMINDER : FOLLOWUP_TYPES.SOFT;
    } else if (count === 1) {
        // Follow-up 2 (Final)
        return FOLLOWUP_TYPES.FINAL;
    } else {
        // More than 2 follow ups without reply -> Abandon
        return 'ABANDON_LEAD';
    }
}

/**
 * Returns the prompt template / textual strategy for the chosen FollowUp Type
 */
export function getFollowUpStrategy(type) {
    switch (type) {
        case FOLLOWUP_TYPES.SOFT:
            return "Revin cu o scurtă reamintire legat de evenimentul dvs. Suntem aici dacă doriți să continuăm discuția sau dacă aveți nevoie de ajutor pentru a finaliza detaliile. Un mesaj scurt și cald, fără nicio presiune.";
        case FOLLOWUP_TYPES.QUOTE_REMINDER:
            return "Revin legat de oferta pe care v-am trimis-o. Aș vrea să mă asigur că a ajuns la dumneavoastră și că totul este în regulă. Dacă sunteți gata să continuăm rezervarea, vă aștept cu un răspuns. Fii profesionist și orientat spre închidere.";
        case FOLLOWUP_TYPES.FINAL:
            return "Acesta este ultimul meu mesaj legat de solicitarea dumneavoastră, pentru a nu deveni intruziv. Dacă decideți să mai colaborăm pentru petrecere, noi rămânem la dispoziție cu mare drag! O zi excelentă! Fii scurt, foarte politicos, și închide elegant conversația.";
        default:
            return "";
    }
}
