import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } from '../config/env.mjs';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

/**
 * Load the active event plan for a conversation, or create a new one.
 * Excludes archived/cancelled/hidden plans from active lookup.
 *
 * @param {string} conversationId
 * @param {string|null} clientId
 * @returns {object} event plan row
 */
export async function loadOrCreateEventPlan(conversationId, clientId) {
    // Try to load active plan (exclude archived/cancelled/hidden)
    const { data: existing, error } = await supabase
        .from('ai_event_plans')
        .select('*')
        .eq('conversation_id', conversationId)
        .in('status', ['draft', 'active', 'awaiting_operator_review', 'quote_ready', 'booking_ready'])
        .eq('hidden_from_active_ui', false)
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
        status: 'draft',
        requested_services: [],
        confirmed_services: [],
        removed_services: [],
        candidate_services: [],
        candidate_packages: [],
        replacements: [],
        extras: [],
        assumptions: [],
        missing_fields: ['requested_services', 'event_date', 'location', 'children_count_estimate',
            'event_time', 'child_age', 'payment_method_preference', 'invoice_requested', 'advance_status'],
        confirmed_fields: [],
        confidence: 10,
        // Readiness flags
        readiness_for_recommendation: false,
        readiness_for_quote: false,
        readiness_for_booking: false,
        // Commercial defaults
        payment_method_preference: 'unknown',
        invoice_requested: 'unknown',
        advance_required: 'unknown',
        advance_status: 'unknown',
        billing_details_status: 'missing',
        // Soft archive defaults
        hidden_from_active_ui: false,
        exclude_from_payroll: false,
        // Control
        source_of_last_mutation: 'system',
        operator_locked: false,
        human_takeover_active_snapshot: false
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
        reason: 'New conversation — draft event plan created'
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

    // Check operator lock
    if (current.operator_locked && changedBy === 'ai') {
        console.log(`[EventPlan] Update blocked — operator_locked=true on ${planId}`);
        return { updated: false, delta: {}, blocked: 'operator_locked' };
    }

    // Compute delta
    const delta = {};
    const cleanUpdates = {};
    for (const [key, value] of Object.entries(updates)) {
        if (value === undefined || value === null) continue;
        
        // Phase 3 Compatibility Layer: Ignore fields not present in legacy schema
        if (!current.hasOwnProperty(key)) {
            // Ignored, they will be picked up by the Party Draft pipeline instead
            continue;
        }

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
    cleanUpdates.source_of_last_mutation = changedBy;

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
 * Soft-archive an event plan.
 * Does NOT delete — sets status, archived_at/by/reason, excludes from active.
 */
export async function archiveEventPlan(planId, conversationId, {
    archivedBy = 'system',
    archiveReason = 'archived',
    excludeFromPayroll = true,
    hideFromActiveUi = true
} = {}) {
    const now = new Date().toISOString();
    const { error } = await supabase
        .from('ai_event_plans')
        .update({
            status: 'archived',
            archived_at: now,
            archived_by: archivedBy,
            archive_reason: archiveReason,
            hidden_from_active_ui: hideFromActiveUi,
            exclude_from_payroll: excludeFromPayroll,
            last_updated_at: now,
            source_of_last_mutation: archivedBy
        })
        .eq('id', planId);

    if (error) console.error('[EventPlan] Archive error:', error.message);

    await logPlanMutation(planId, conversationId, {
        mutation_type: 'archive',
        changed_by: archivedBy,
        reason: archiveReason,
        after_json: { status: 'archived', archived_at: now, hidden_from_active_ui: hideFromActiveUi, exclude_from_payroll: excludeFromPayroll }
    });

    console.log(`[EventPlan] Archived ${planId}: by=${archivedBy}, reason=${archiveReason}`);
}

/**
 * Cancel an event plan (soft — no hard delete).
 */
export async function cancelEventPlan(planId, conversationId, {
    cancelledBy = 'ai',
    cancelReason = 'cancelled_by_client'
} = {}) {
    const now = new Date().toISOString();
    const { error } = await supabase
        .from('ai_event_plans')
        .update({
            status: 'cancelled',
            archived_at: now,
            archived_by: cancelledBy,
            archive_reason: cancelReason,
            hidden_from_active_ui: true,
            exclude_from_payroll: true,
            last_updated_at: now,
            source_of_last_mutation: cancelledBy
        })
        .eq('id', planId);

    if (error) console.error('[EventPlan] Cancel error:', error.message);

    await logPlanMutation(planId, conversationId, {
        mutation_type: 'cancel',
        changed_by: cancelledBy,
        reason: cancelReason
    });
}

/**
 * Reactivate a cancelled/archived event plan.
 * Restores to draft status, clears archive fields.
 */
export async function reactivateEventPlan(planId, conversationId, reason = 'reactivated') {
    const now = new Date().toISOString();
    const { error } = await supabase
        .from('ai_event_plans')
        .update({
            status: 'draft',
            archived_at: null,
            archived_by: null,
            archive_reason: null,
            hidden_from_active_ui: false,
            exclude_from_payroll: false,
            last_updated_at: now,
            source_of_last_mutation: 'ai'
        })
        .eq('id', planId);

    if (error) console.error('[EventPlan] Reactivate error:', error.message);

    await logPlanMutation(planId, conversationId, {
        mutation_type: 'reactivate',
        reason
    });

    console.log(`[EventPlan] Reactivated ${planId}`);
}

/**
 * Log a mutation to the event plan history (append-only, never deleted).
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
