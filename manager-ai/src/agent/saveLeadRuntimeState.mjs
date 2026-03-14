import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } from '../config/env.mjs';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

/**
 * Saves/updates the operational lead runtime state.
 * Only applies changes based on the provided updates object.
 *
 * @param {string} conversationId 
 * @param {object} updates 
 */
export async function saveLeadRuntimeState(conversationId, updates) {
    if (!conversationId) return;

    // Filter out undefined values to avoid wiping out data
    const cleanUpdates = {};
    for (const [key, value] of Object.entries(updates)) {
        if (value !== undefined) {
            cleanUpdates[key] = value;
        }
    }

    if (Object.keys(cleanUpdates).length === 0) return;

    const { error } = await supabase
        .from('ai_lead_runtime_states')
        .update(cleanUpdates)
        .eq('conversation_id', conversationId);

    if (error) {
        console.error(`[LeadRuntimeState] Save error for ${conversationId}:`, error.message);
    }
}
