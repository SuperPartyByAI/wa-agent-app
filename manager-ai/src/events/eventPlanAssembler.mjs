import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } from '../config/env.mjs';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

/**
 * Load the active event plan for a conversation, or create a new one.
 *
 * @param {string} conversationId
 * @param {string|null} clientId
 * @returns {object} event plan row
 */
export async function loadOrCreateEventPlan(conversationId, clientId) {
    // Try to load active plan
    const { data: existing, error } = await supabase
        .from('ai_event_plans')
        .select('*')
        .eq('conversation_id', conversationId)
        .eq('status', 'active')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

    if (error) {
        console.error('[EventPlan] Load error:', error.message);
    }

    if (existing) return existing;

    // Create new empty plan
    const newPlan = {
        conversation_id: conversationId,
        client_id: clientId,
        status: 'active',
        requested_services: [],
        confirmed_services: [],
        removed_services: [],
        candidate_services: [],
        candidate_packages: [],
        extras: [],
        assumptions: [],
        missing_fields: ['event_date', 'location', 'guest_count', 'event_time'],
        confirmed_fields: [],
        confidence: 10,
        readiness_for_quote: false,
        readiness_for_booking: false
    };

    const { data: created, error: insertErr } = await supabase
        .from('ai_event_plans')
        .insert(newPlan)
        .select('*')
        .single();

    if (insertErr) {
        console.error('[EventPlan] Create error:', insertErr.message);
        return { ...newPlan, id: null, _isNew: true };
    }

    console.log(`[EventPlan] Created new plan ${created.id} for conv ${conversationId}`);

    // Log creation in history
    await logPlanMutation(created.id, conversationId, {
        mutation_type: 'create',
        after_json: newPlan,
        reason: 'New conversation — empty event plan created'
    });

    return created;
}

/**
 * Update event plan fields incrementally.
 * Computes delta, persists, logs to history.
 *
 * @param {string} planId
 * @param {string} conversationId
 * @param {object} updates - fields to update
 * @param {string} changedBy - 'ai' or 'operator'
 * @param {string} reason
 * @returns {{ updated: boolean, delta: object }}
 */
export async function updateEventPlan(planId, conversationId, updates, changedBy = 'ai', reason = '') {
    if (!planId) return { updated: false, delta: {} };

    // Load current state for delta
    const { data: current } = await supabase
        .from('ai_event_plans')
        .select('*')
        .eq('id', planId)
        .single();

    if (!current) return { updated: false, delta: {} };

    // Compute delta
    const delta = {};
    const cleanUpdates = {};
    for (const [key, value] of Object.entries(updates)) {
        if (value === undefined || value === null) continue;
        const oldVal = current[key];
        if (JSON.stringify(oldVal) !== JSON.stringify(value)) {
            delta[key] = { before: oldVal, after: value };
            cleanUpdates[key] = value;
        }
    }

    if (Object.keys(cleanUpdates).length === 0) {
        return { updated: false, delta: {} };
    }

    // Persist update
    cleanUpdates.last_updated_by = changedBy;
    cleanUpdates.last_updated_at = new Date().toISOString();

    const { error } = await supabase
        .from('ai_event_plans')
        .update(cleanUpdates)
        .eq('id', planId);

    if (error) {
        console.error('[EventPlan] Update error:', error.message);
        return { updated: false, delta };
    }

    // Log to history
    await logPlanMutation(planId, conversationId, {
        mutation_type: 'update',
        before_json: Object.fromEntries(Object.entries(delta).map(([k, v]) => [k, v.before])),
        after_json: Object.fromEntries(Object.entries(delta).map(([k, v]) => [k, v.after])),
        delta_json: delta,
        changed_by: changedBy,
        reason
    });

    const changedKeys = Object.keys(delta).join(', ');
    console.log(`[EventPlan] Updated ${planId}: ${changedKeys} (by=${changedBy})`);

    return { updated: true, delta };
}

/**
 * Archive an event plan (soft-delete).
 */
export async function archiveEventPlan(planId, conversationId, reason = 'archived') {
    const { error } = await supabase
        .from('ai_event_plans')
        .update({ status: 'archived', last_updated_at: new Date().toISOString() })
        .eq('id', planId);

    if (error) console.error('[EventPlan] Archive error:', error.message);

    await logPlanMutation(planId, conversationId, {
        mutation_type: 'archive',
        reason
    });
}

/**
 * Reactivate a cancelled/archived event plan.
 */
export async function reactivateEventPlan(planId, conversationId, reason = 'reactivated') {
    const { error } = await supabase
        .from('ai_event_plans')
        .update({ status: 'active', last_updated_at: new Date().toISOString() })
        .eq('id', planId);

    if (error) console.error('[EventPlan] Reactivate error:', error.message);

    await logPlanMutation(planId, conversationId, {
        mutation_type: 'reactivate',
        reason
    });
}

/**
 * Log a mutation to the event plan history (append-only).
 */
async function logPlanMutation(planId, conversationId, entry) {
    const { error } = await supabase
        .from('ai_event_plan_history')
        .insert({
            event_plan_id: planId,
            conversation_id: conversationId,
            mutation_type: entry.mutation_type,
            changed_by: entry.changed_by || 'ai',
            before_json: entry.before_json || null,
            after_json: entry.after_json || null,
            delta_json: entry.delta_json || null,
            reason: entry.reason || '',
            confidence: entry.confidence || 80
        });

    if (error) {
        console.error('[EventPlan] History insert error:', error.message);
    }
}
