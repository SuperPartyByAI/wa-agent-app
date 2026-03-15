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

    // Fetch old state for audit
    const { data: oldState } = await supabase
        .from('ai_lead_runtime_states')
        .select('*')
        .eq('conversation_id', conversationId)
        .single();

    const { error } = await supabase
        .from('ai_lead_runtime_states')
        .update(cleanUpdates)
        .eq('conversation_id', conversationId);

    if (error) {
        console.error(`[LeadRuntimeState] Save error for ${conversationId}:`, error.message);
        return;
    }

    // Insert Audit Trail entries if there are changes in tracked fields
    const auditEntries = [];

    if (oldState) {
        if (cleanUpdates.lead_state && cleanUpdates.lead_state !== oldState.lead_state) {
            auditEntries.push({
                conversation_id: conversationId,
                event_type: 'state_change',
                old_state: oldState.lead_state,
                new_state: cleanUpdates.lead_state,
                reason: 'pipeline_progression'
            });
        }
        if (cleanUpdates.next_best_action && cleanUpdates.next_best_action !== oldState.next_best_action) {
            auditEntries.push({
                conversation_id: conversationId,
                event_type: 'nba_change',
                old_state: oldState.next_best_action,
                new_state: cleanUpdates.next_best_action,
                reason: cleanUpdates.last_agent_goal || 'goal_update'
            });
        }
        if (cleanUpdates.handoff_to_operator === true && oldState.handoff_to_operator !== true) {
             auditEntries.push({
                conversation_id: conversationId,
                event_type: 'handoff',
                old_state: 'ai_owned',
                new_state: 'operator_owned',
                reason: cleanUpdates.handoff_reason || 'manual_trigger'
            });
        }
        if (cleanUpdates.followup_status && cleanUpdates.followup_status !== oldState.followup_status) {
            auditEntries.push({
                conversation_id: conversationId,
                event_type: 'followup_status_change',
                old_state: oldState.followup_status || 'none',
                new_state: cleanUpdates.followup_status,
                reason: cleanUpdates.next_best_action || 'followup_job'
            });
        }
        if (cleanUpdates.closed_status && cleanUpdates.closed_status !== oldState.closed_status && cleanUpdates.closed_status !== 'open') {
             auditEntries.push({
                conversation_id: conversationId,
                event_type: 'close_state',
                old_state: oldState.closed_status || 'open',
                new_state: cleanUpdates.closed_status,
                reason: cleanUpdates.handoff_reason || cleanUpdates.do_not_followup_reason || 'pipeline_closure'
            });
        }
        if (cleanUpdates.do_not_followup === true && oldState.do_not_followup !== true) {
             auditEntries.push({
                conversation_id: conversationId,
                event_type: 'block_followup',
                old_state: 'active',
                new_state: 'blocked',
                reason: cleanUpdates.do_not_followup_reason || 'client_said_revin_eu'
            });
        }
    }

    if (auditEntries.length > 0) {
        const { error: auditError } = await supabase.from('ai_lead_audit_trail').insert(auditEntries);
        if (auditError) {
             console.error(`[LeadRuntimeState] Save Audit error for ${conversationId}:`, auditError.message);
        }
    }
}
