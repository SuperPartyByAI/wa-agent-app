import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } from '../config/env.mjs';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

/**
 * Loads the structured entity memory for a client from ai_client_memory.memory_json
 * Returns the memory object or a default empty structure.
 */
export async function loadClientMemory(clientId) {
    if (!clientId) return getDefaultMemory();

    const { data, error } = await supabase
        .from('ai_client_memory')
        .select('memory_json, preferences_json, priority_level, internal_notes_summary')
        .eq('client_id', clientId)
        .maybeSingle();

    if (error || !data) return getDefaultMemory();

    // Parse memory_json which contains structured entity data
    const memory = data.memory_json || {};
    return {
        entity_type: memory.entity_type || 'unknown',
        entity_confidence: memory.entity_confidence || 0,
        usual_locations: memory.usual_locations || [],
        usual_services: memory.usual_services || [],
        preferences: memory.preferences || {},
        behavior_patterns: memory.behavior_patterns || [],
        notes_for_ops: memory.notes_for_ops || [],
        // Keep legacy fields accessible
        priority_level: data.priority_level || 'normal',
        internal_notes_summary: data.internal_notes_summary || ''
    };
}

function getDefaultMemory() {
    return {
        entity_type: 'unknown',
        entity_confidence: 0,
        usual_locations: [],
        usual_services: [],
        preferences: {},
        behavior_patterns: [],
        notes_for_ops: [],
        priority_level: 'normal',
        internal_notes_summary: ''
    };
}
