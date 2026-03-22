import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } from '../config/env.mjs';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

/**
 * Loads the operational lead runtime state for a conversation.
 * If none exists, creates a fresh default state.
 *
 * @param {string} conversationId 
 * @returns {object} The lead runtime state
 */
export async function loadLeadRuntimeState(conversationId) {
    if (!conversationId) {
        throw new Error('[LeadRuntimeState] Cannot load state without conversationId');
    }

    const { data: state, error } = await supabase
        .from('ai_lead_runtime_states')
        .select('*')
        .eq('conversation_id', conversationId)
        .limit(1)
        .maybeSingle();

    if (error) {
        console.error(`[LeadRuntimeState] Error loading state for ${conversationId}:`, error.message);
        throw error;
    }

    if (state) {
        return state;
    }

    // No existing state, create a default one
    const newState = {
        conversation_id: conversationId,
        lead_state: 'lead_nou',
        last_agent_goal: null,
        next_best_action: null,
        primary_service: null,
        active_roles: [],
        known_fields: {},
        missing_fields: [],
        human_takeover: false,
        lead_score: 0.00,
        follow_up_due_at: null
    };

    const { data: created, error: insertErr } = await supabase
        .from('ai_lead_runtime_states')
        .insert(newState)
        .select('*')
        .single();

    if (insertErr) {
        console.error(`[LeadRuntimeState] Error creating state for ${conversationId}:`, insertErr.message);
        // Return memory-only fallback to avoid crashing pipeline if DB write fails temporarily
        return newState;
    }

    return created;
}
