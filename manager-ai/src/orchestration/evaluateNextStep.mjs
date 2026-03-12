import { CATALOG_MAP } from '../services/postProcessServices.mjs';

/**
 * Conversation Progression Engine
 *  
 * Evaluates where the conversation is and what the next logical step is.
 * Consumes buildReplyContext output + draft state + mutation result.
 *
 * @param {object} params
 * @param {object} params.replyContext      - from buildReplyContext()
 * @param {object} params.draft             - current ai_event_drafts row (or null)
 * @param {object} params.mutation          - from detectEventMutation()
 * @param {object} params.mutationResult    - from applyEventMutation()
 * @param {object} params.decision          - LLM decision object
 * @param {object} params.analysis          - full LLM analysis
 * @param {object} params.serviceConfidence - from evaluateServiceConfidence()
 * @returns {object} progression
 */
export function evaluateNextStep({
    replyContext,
    draft,
    mutation,
    mutationResult,
    decision,
    analysis,
    serviceConfidence
}) {
    const result = {
        next_step: 'discover_services',
        next_step_reason: '',
        next_question_field: null,
        progression_status: 'collecting_info',
        can_continue_autonomously: true,
        should_escalate: false,
        missing_critical_count: 0,
        completed_fields: [],
        total_fields_needed: 0
    };

    // ── Extract draft state ──
    const draftData = draft?.structured_data_json || analysis?.event_draft?.structured_data || {};
    const draftServices = draft?.services || analysis?.selected_services || [];
    const draftStatus = draft?.draft_status || 'none';

    // ── Critical fields tracking ──
    const criticalFields = [
        { key: 'services', label: 'Servicii', filled: draftServices.length > 0 },
        { key: 'date', label: 'Data', filled: !!draftData.date },
        { key: 'location', label: 'Locație', filled: !!draftData.location },
        { key: 'time', label: 'Ora', filled: !!(draftData.ora || draftData.ora_start || draftData.interval_orar) },
        { key: 'guest_count', label: 'Nr. invitați', filled: !!(draftData.numar_copii || draftData.numar_invitati || draftData.nr_copii) }
    ];

    result.total_fields_needed = criticalFields.length;
    result.completed_fields = criticalFields.filter(f => f.filled).map(f => f.key);
    const missingCritical = criticalFields.filter(f => !f.filled);
    result.missing_critical_count = missingCritical.length;

    // ── Service-specific fields ──
    const svcSpecificMissing = [];
    const missingPerService = analysis?.missing_fields_per_service || {};
    for (const svc of draftServices) {
        const fields = missingPerService[svc] || [];
        for (const f of fields) {
            if (!svcSpecificMissing.includes(f)) svcSpecificMissing.push(f);
        }
    }

    // ── Determine next step from service detection status ──
    const svcStatus = serviceConfidence?.service_detection_status || replyContext?.serviceDetectionStatus || 'unknown';

    if (svcStatus === 'unknown' || svcStatus === 'ambiguous') {
        result.next_step = 'discover_services';
        result.next_step_reason = 'Serviciile nu sunt clare — trebuie întrebat clientul ce dorește.';
        result.next_question_field = 'servicii_dorite';
        result.progression_status = 'collecting_info';
        return result;
    }

    // ── Determine next step from critical fields ──
    if (draftServices.length === 0) {
        result.next_step = 'discover_services';
        result.next_step_reason = 'Nu au fost detectate servicii.';
        result.next_question_field = 'servicii_dorite';
        return result;
    }

    // Priority order for missing critical fields
    const fieldStepMap = [
        { key: 'date', step: 'ask_event_date', field: 'data_eveniment', reason: 'Data lipșeste.' },
        { key: 'location', step: 'ask_location', field: 'locatie', reason: 'Locația lipsește.' },
        { key: 'time', step: 'ask_time', field: 'ora_start', reason: 'Ora lipsește.' },
        { key: 'guest_count', step: 'ask_guest_count', field: 'numar_copii', reason: 'Nr. invitați lipsește.' }
    ];

    for (const mapping of fieldStepMap) {
        const field = criticalFields.find(f => f.key === mapping.key);
        if (field && !field.filled) {
            result.next_step = mapping.step;
            result.next_step_reason = mapping.reason;
            result.next_question_field = mapping.field;
            result.progression_status = 'collecting_info';
            return result;
        }
    }

    // ── Service-specific missing fields ──
    if (svcSpecificMissing.length > 0) {
        result.next_step = 'ask_service_specific_fields';
        result.next_step_reason = `Câmpuri specifice lipsă: ${svcSpecificMissing.slice(0, 3).join(', ')}`;
        result.next_question_field = svcSpecificMissing[0];
        result.progression_status = 'collecting_info';
        return result;
    }

    // ── All critical fields filled ──
    // Check if a mutation just happened → confirm changes
    if (mutation && mutation.mutation_type !== 'no_mutation' && mutationResult?.applied) {
        result.next_step = 'confirm_changes';
        result.next_step_reason = `Mutație ${mutation.mutation_type} aplicată — confirm cu clientul.`;
        result.next_question_field = null;
        result.progression_status = 'confirming';
        return result;
    }

    // Check draft status
    if (draftStatus === 'cancelled') {
        result.next_step = 'completed_for_now';
        result.next_step_reason = 'Draft anulat.';
        result.progression_status = 'completed';
        result.can_continue_autonomously = false;
        return result;
    }

    // All info collected → ready for quote
    if (missingCritical.length === 0) {
        result.next_step = 'ready_for_quote';
        result.next_step_reason = 'Toate informațiile critice sunt completate.';
        result.next_question_field = null;
        result.progression_status = 'ready_for_quote';
        // Quote/booking requires human
        result.can_continue_autonomously = false;
        result.should_escalate = true;
        return result;
    }

    // Default: continue collecting
    result.next_step = 'completed_for_now';
    result.next_step_reason = 'Conversație la zi.';
    result.progression_status = 'completed';
    return result;
}
