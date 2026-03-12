/**
 * Detects the type of event mutation from LLM analysis output
 * by comparing against the existing draft state.
 *
 * Pure logic — no LLM call, no DB access.
 *
 * @param {object} analysis       - LLM analysis output
 * @param {object} existingDraft  - current draft from DB (null if none)
 * @returns {object} mutation descriptor
 */
export function detectEventMutation(analysis, existingDraft) {
    const mutationIntent = analysis.mutation_intent || {};
    const eventDraft = analysis.event_draft || {};
    const newServices = analysis.selected_services || [];
    const conversationState = analysis.conversation_state || {};

    // If LLM explicitly provided a mutation_intent, use it
    if (mutationIntent.type && mutationIntent.type !== 'no_mutation') {
        return buildMutation({
            type: mutationIntent.type,
            targetField: mutationIntent.target_field || null,
            oldValue: mutationIntent.old_value || null,
            newValue: mutationIntent.new_value || null,
            addedServices: mutationIntent.added_services || [],
            removedServices: mutationIntent.removed_services || [],
            confidence: mutationIntent.confidence || 70,
            reason: mutationIntent.reason || 'LLM explicit intent'
        });
    }

    // No existing draft → this is a create
    if (!existingDraft || !existingDraft.structured_data_json) {
        if (newServices.length > 0 || eventDraft.structured_data?.date || eventDraft.structured_data?.location) {
            return buildMutation({
                type: 'create_event',
                confidence: 90,
                reason: 'No existing draft, new event data detected'
            });
        }
        return buildMutation({ type: 'no_mutation', confidence: 100, reason: 'No draft, no new data' });
    }

    const existingData = existingDraft.structured_data_json || {};
    const newData = eventDraft.structured_data || {};
    const existingStatus = existingDraft.draft_status || 'active';

    // Check for cancellation intent
    const intent = conversationState.current_intent?.toLowerCase() || '';
    if (intent.includes('anuleaza') || intent.includes('cancel') || intent.includes('renunt')) {
        return buildMutation({
            type: 'cancel_event',
            confidence: 85,
            reason: `Cancel intent detected: "${conversationState.current_intent}"`
        });
    }

    // Check for reactivation (cancelled draft + new activity)
    if (existingStatus === 'cancelled' && (newServices.length > 0 || newData.date)) {
        return buildMutation({
            type: 'reactivate_event',
            confidence: 80,
            reason: 'Cancelled draft with new event data'
        });
    }

    // Detect field changes
    const fieldChanges = [];

    if (newData.date && newData.date !== existingData.date && existingData.date) {
        fieldChanges.push({ field: 'date', old: existingData.date, new: newData.date });
    }
    if (newData.location && newData.location !== existingData.location && existingData.location) {
        fieldChanges.push({ field: 'location', old: existingData.location, new: newData.location });
    }
    if (newData.event_type && newData.event_type !== existingData.event_type && existingData.event_type) {
        fieldChanges.push({ field: 'event_type', old: existingData.event_type, new: newData.event_type });
    }
    if (newData.time && newData.time !== existingData.time && existingData.time) {
        fieldChanges.push({ field: 'time', old: existingData.time, new: newData.time });
    }
    if (newData.guest_count && newData.guest_count !== existingData.guest_count && existingData.guest_count) {
        fieldChanges.push({ field: 'guest_count', old: existingData.guest_count, new: newData.guest_count });
    }

    // Single field change → specific mutation type
    if (fieldChanges.length === 1) {
        const typeMap = { date: 'change_date', location: 'change_location', time: 'change_time', guest_count: 'change_guest_count' };
        return buildMutation({
            type: typeMap[fieldChanges[0].field] || 'update_event',
            fieldChanges,
            confidence: 85,
            reason: `Changed ${fieldChanges[0].field}: ${fieldChanges[0].old} → ${fieldChanges[0].new}`
        });
    }

    // Multiple field changes → generic update
    if (fieldChanges.length > 1) {
        return buildMutation({
            type: 'update_event',
            fieldChanges,
            confidence: 80,
            reason: `Multiple fields changed: ${fieldChanges.map(f => f.field).join(', ')}`
        });
    }

    // Detect service changes
    const existingServices = existingDraft.services || [];
    const added = newServices.filter(s => !existingServices.includes(s));
    const removed = existingServices.filter(s => !newServices.includes(s));

    if (added.length > 0 && removed.length > 0) {
        return buildMutation({
            type: 'replace_service',
            addedServices: added,
            removedServices: removed,
            confidence: 75,
            reason: `Replaced: -${removed.join(',')} +${added.join(',')}`
        });
    }
    if (added.length > 0) {
        return buildMutation({
            type: 'add_service',
            addedServices: added,
            confidence: 80,
            reason: `Added services: ${added.join(', ')}`
        });
    }
    if (removed.length > 0 && newServices.length > 0) {
        return buildMutation({
            type: 'remove_service',
            removedServices: removed,
            confidence: 75,
            reason: `Removed services: ${removed.join(', ')}`
        });
    }

    // New data filling in blanks (not a change, just enrichment)
    const enriched = [];
    if (newData.date && !existingData.date) enriched.push('date');
    if (newData.location && !existingData.location) enriched.push('location');
    if (newData.event_type && !existingData.event_type) enriched.push('event_type');

    if (enriched.length > 0) {
        return buildMutation({
            type: 'update_event',
            fieldChanges: enriched.map(f => ({ field: f, old: null, new: newData[f] })),
            confidence: 90,
            reason: `New info provided: ${enriched.join(', ')}`
        });
    }

    return buildMutation({ type: 'no_mutation', confidence: 100, reason: 'No detectable changes' });
}

function buildMutation({
    type,
    targetField = null,
    oldValue = null,
    newValue = null,
    addedServices = [],
    removedServices = [],
    fieldChanges = [],
    confidence = 70,
    reason = ''
}) {
    return {
        mutation_type: type,
        target_field: targetField,
        old_value: oldValue,
        new_value: newValue,
        added_services: addedServices,
        removed_services: removedServices,
        field_changes: fieldChanges,
        event_status_change: type === 'cancel_event' ? 'cancelled'
            : type === 'reactivate_event' ? 'active'
            : null,
        mutation_confidence: confidence,
        needs_review: confidence < 60 || type === 'cancel_event',
        mutation_reason: reason
    };
}
