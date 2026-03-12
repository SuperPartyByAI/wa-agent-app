import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } from '../config/env.mjs';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

/**
 * Updates the structured entity memory in ai_client_memory.
 * Merges new LLM-extracted memory with existing memory (additive, not destructive).
 *
 * @param {string} clientId
 * @param {object} llmEntityMemory   - entity_memory block from LLM output
 * @param {object} existingMemory    - current memory from loadClientMemory()
 * @param {object} llmClientMemory   - client_memory block from LLM output (priority, summary)
 */
export async function updateClientMemory(clientId, llmEntityMemory, existingMemory, llmClientMemory) {
    if (!clientId) return;

    // Merge entity type — keep higher confidence
    const newEntityType = llmEntityMemory?.entity_type || existingMemory.entity_type || 'unknown';
    const newEntityConf = Math.max(
        llmEntityMemory?.entity_confidence || 0,
        existingMemory.entity_confidence || 0
    );

    // Merge usual_locations — additive, deduplicate by name
    const mergedLocations = mergeByField(
        existingMemory.usual_locations || [],
        llmEntityMemory?.usual_locations || [],
        'name'
    );

    // Merge usual_services — additive, deduplicate by service_key
    const mergedServices = mergeByField(
        existingMemory.usual_services || [],
        llmEntityMemory?.usual_services || [],
        'service_key'
    );

    // Merge preferences — shallow merge, new wins
    const mergedPrefs = {
        ...(existingMemory.preferences || {}),
        ...(llmEntityMemory?.preferences || {})
    };

    // Merge behavior_patterns — deduplicate strings
    const mergedPatterns = [...new Set([
        ...(existingMemory.behavior_patterns || []),
        ...(llmEntityMemory?.behavior_patterns || [])
    ])];

    // Merge notes_for_ops — deduplicate
    const mergedNotes = [...new Set([
        ...(existingMemory.notes_for_ops || []),
        ...(llmEntityMemory?.notes_for_ops || [])
    ])];

    const memoryJson = {
        entity_type: newEntityType,
        entity_confidence: newEntityConf,
        usual_locations: mergedLocations,
        usual_services: mergedServices,
        preferences: mergedPrefs,
        behavior_patterns: mergedPatterns,
        notes_for_ops: mergedNotes,
        last_updated: new Date().toISOString()
    };

    const { error } = await supabase.from('ai_client_memory').upsert({
        client_id: clientId,
        priority_level: llmClientMemory?.priority_level || existingMemory.priority_level || 'normal',
        internal_notes_summary: llmClientMemory?.internal_notes_summary || existingMemory.internal_notes_summary || '',
        memory_json: memoryJson,
        updated_at: new Date().toISOString()
    });

    if (error) console.error('[Memory] DB Error updating memory:', error.message);
    else console.log(`[Memory] Updated entity memory for client ${clientId}: type=${newEntityType} (${newEntityConf}%), locations=${mergedLocations.length}, services=${mergedServices.length}`);
}

/**
 * Merge two arrays of objects by a key field. New entries overwrite existing ones with same key.
 */
function mergeByField(existing, incoming, keyField) {
    const map = new Map();
    for (const item of existing) {
        if (item[keyField]) map.set(item[keyField], item);
    }
    for (const item of incoming) {
        if (item[keyField]) map.set(item[keyField], { ...map.get(item[keyField]), ...item });
    }
    return [...map.values()];
}
