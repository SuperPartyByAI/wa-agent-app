import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL || 'https://jrfhprnuxxfwkwjwdsez.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

/**
 * Persists the current state of the Party Draft back to Supabase.
 * Includes optimistic upserts taking advantage of JSONB columns.
 */
export async function savePartyDraft(partyDraft) {
    if (!partyDraft.conversation_id) {
        console.error("[savePartyDraft] Cannot save draft without conversation_id");
        return false;
    }

    try {
        // Upsert based on the unique conversation_id logic
        const { data, error } = await supabase
            .from('ai_party_drafts')
            .upsert(partyDraft, { onConflict: 'conversation_id', returning: 'minimal' });

        if (error) {
            console.error(`[savePartyDraft] DB Error: ${error.message} \nDetails: ${error.details}`);
            // If the table literally doesn't exist yet (because the DDL hasn't run), log but don't hard crash
            if (error.code === '42P01') {
                console.warn("[savePartyDraft] The ai_party_drafts table does not exist. Ignoring save.");
            }
            return false;
        }

        return true;
    } catch (e) {
        console.error(`[savePartyDraft] Exception: ${e.message}`);
        return false;
    }
}
