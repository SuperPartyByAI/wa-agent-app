import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } from '../config/env.mjs';
import { insertMutation, updateDraftStatus, incrementDraftVersion } from '../repositories/mutationRepository.mjs';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

/**
 * Applies a detected mutation to the event draft.
 *
 * 1. Snapshots current state (before_json)
 * 2. Applies changes to structured_data
 * 3. Snapshots new state (after_json)
 * 4. Computes delta
 * 5. Persists mutation log
 * 6. Updates draft in DB
 *
 * @param {object} params
 * @param {object} params.mutation       - from detectEventMutation()
 * @param {object} params.existingDraft  - current draft row from DB
 * @param {object} params.newDraftData   - LLM's event_draft output
 * @param {object} params.newServices    - LLM's selected_services
 * @param {string} params.conversationId
 * @param {string} params.clientId
 * @returns {object} { applied, draftId, mutationId, afterState }
 */
export async function applyEventMutation({
    mutation,
    existingDraft,
    newDraftData,
    newServices,
    conversationId,
    clientId
}) {
    const mutationType = mutation.mutation_type;

    // Skip if no mutation
    if (mutationType === 'no_mutation') {
        return { applied: false, reason: 'no_mutation' };
    }

    const beforeState = existingDraft?.structured_data_json || {};
    const beforeServices = existingDraft?.services || [];
    const beforeStatus = existingDraft?.draft_status || 'active';

    // ── Build new state ──
    let afterState = { ...beforeState };
    let afterServices = [...beforeServices];
    let afterStatus = beforeStatus;

    switch (mutationType) {
        case 'create_event':
            afterState = newDraftData.structured_data || {};
            afterServices = newServices || [];
            afterStatus = 'active';
            break;

        case 'cancel_event':
            afterStatus = 'cancelled';
            break;

        case 'reactivate_event':
            afterState = { ...beforeState, ...(newDraftData.structured_data || {}) };
            afterServices = newServices.length > 0 ? newServices : beforeServices;
            afterStatus = 'active';
            break;

        case 'change_date':
        case 'change_location':
        case 'change_time':
        case 'change_guest_count':
        case 'update_event':
            // Merge new fields over existing
            for (const change of (mutation.field_changes || [])) {
                if (change.new !== null && change.new !== undefined) {
                    afterState[change.field] = change.new;
                }
            }
            // Also merge any new structured data from LLM
            const newStructured = newDraftData.structured_data || {};
            for (const [key, val] of Object.entries(newStructured)) {
                if (val && val !== 'null') {
                    afterState[key] = val;
                }
            }
            afterServices = newServices.length > 0 ? newServices : beforeServices;
            break;

        case 'add_service':
            afterServices = [...new Set([...beforeServices, ...newServices])];
            break;

        case 'remove_service':
            afterServices = beforeServices.filter(s => !mutation.removed_services.includes(s));
            break;

        case 'replace_service':
            afterServices = beforeServices
                .filter(s => !mutation.removed_services.includes(s))
                .concat(mutation.added_services || []);
            afterServices = [...new Set(afterServices)];
            break;

        case 'confirm_event':
            afterStatus = 'confirmed';
            break;

        default:
            // Generic: merge new data
            afterState = { ...beforeState, ...(newDraftData.structured_data || {}) };
            afterServices = newServices.length > 0 ? newServices : beforeServices;
            break;
    }

    // ── Compute delta ──
    const delta = {};
    for (const key of new Set([...Object.keys(beforeState), ...Object.keys(afterState)])) {
        if (JSON.stringify(beforeState[key]) !== JSON.stringify(afterState[key])) {
            delta[key] = { before: beforeState[key] || null, after: afterState[key] || null };
        }
    }
    // Service delta
    const addedSvcs = afterServices.filter(s => !beforeServices.includes(s));
    const removedSvcs = beforeServices.filter(s => !afterServices.includes(s));
    if (addedSvcs.length > 0) delta._added_services = addedSvcs;
    if (removedSvcs.length > 0) delta._removed_services = removedSvcs;
    if (afterStatus !== beforeStatus) delta._status = { before: beforeStatus, after: afterStatus };

    // ── Persist draft ──
    const draftPayload = {
        client_id: clientId,
        draft_type: newDraftData.draft_type || existingDraft?.draft_type || 'petrecere_standard',
        structured_data_json: afterState,
        missing_fields_json: newDraftData.missing_fields || [],
        services: afterServices,
        updated_at: new Date().toISOString()
    };

    let draftId = existingDraft?.id;

    if (existingDraft) {
        // Update existing
        const { error } = await supabase
            .from('ai_event_drafts')
            .update(draftPayload)
            .eq('id', existingDraft.id);
        if (error) console.error('[Mutation] Draft update error:', error.message);

        // Update status if changed
        if (afterStatus !== beforeStatus) {
            await updateDraftStatus(
                existingDraft.id,
                afterStatus,
                'ai',
                mutationType === 'cancel_event' ? mutation.mutation_reason : null
            );
        }

        // Increment version
        await incrementDraftVersion(existingDraft.id, existingDraft.version);
    } else {
        // Insert new
        const { data: newRow, error } = await supabase
            .from('ai_event_drafts')
            .insert({ conversation_id: conversationId, ...draftPayload, draft_status: afterStatus })
            .select('id')
            .single();
        if (error) console.error('[Mutation] Draft insert error:', error.message);
        draftId = newRow?.id;
    }

    // ── Persist mutation log ──
    const mutationId = await insertMutation({
        conversation_id: conversationId,
        event_draft_id: draftId,
        mutation_type: mutationType,
        changed_by: 'ai',
        before_json: { structured_data: beforeState, services: beforeServices, status: beforeStatus },
        after_json: { structured_data: afterState, services: afterServices, status: afterStatus },
        delta_json: delta,
        reason_summary: mutation.mutation_reason,
        confidence: mutation.mutation_confidence
    });

    console.log(`[Mutation] Applied ${mutationType}: ${mutation.mutation_reason} (confidence=${mutation.mutation_confidence}, draft=${draftId}, mutation=${mutationId})`);

    return {
        applied: true,
        draftId,
        mutationId,
        mutation_type: mutationType,
        afterState,
        afterServices,
        afterStatus,
        delta
    };
}
