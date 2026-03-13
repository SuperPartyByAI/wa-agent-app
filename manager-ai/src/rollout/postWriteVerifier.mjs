import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } from '../config/env.mjs';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

/**
 * Post-Write Verifier — Phase 5
 * 
 * Read-after-write verification for update_event_plan.
 * Compares tool_action.arguments vs actual DB row after mutation.
 */

/**
 * Verify that update_event_plan persisted correctly.
 * @param {string} planId - Event plan ID
 * @param {object} requestedUpdates - What the LLM asked to write
 * @param {object} goalStateBefore - Goal state before mutation
 * @returns {{ verified: boolean, requested: object, persisted: object, mismatches: object[], goalConsistent: boolean }}
 */
export async function verifyPostWrite(planId, requestedUpdates, goalStateBefore = null) {
    // Read the plan after write
    const { data: plan, error } = await supabase
        .from('ai_event_plans')
        .select('*')
        .eq('id', planId)
        .single();

    if (error || !plan) {
        return {
            verified: false,
            error: error?.message || 'Plan not found after write',
            requested: requestedUpdates,
            persisted: null,
            mismatches: [{ field: '_plan', type: 'not_found' }],
            goalConsistent: false
        };
    }

    // Compare requested vs persisted
    const mismatches = [];
    const persisted = {};
    const rejected = {};

    for (const [field, value] of Object.entries(requestedUpdates)) {
        if (value === undefined || value === null) continue;

        const persistedVal = plan[field];
        persisted[field] = persistedVal;

        // Type-aware comparison (handle number vs string, date formats)
        const match = compareValues(value, persistedVal, field);
        if (!match) {
            mismatches.push({
                field,
                requested: value,
                persisted: persistedVal,
                type: persistedVal === null ? 'not_written' : 'value_mismatch'
            });
            rejected[field] = { requested: value, got: persistedVal };
        }
    }

    // Goal state consistency check
    let goalConsistent = true;
    if (goalStateBefore) {
        const { data: goalAfter } = await supabase
            .from('ai_goal_states')
            .select('current_state, updated_at')
            .eq('conversation_id', plan.conversation_id)
            .order('updated_at', { ascending: false })
            .limit(1)
            .maybeSingle();

        // After an update with real data, we expect the goal state to have progressed
        // or at least not be stuck at new_lead if we have substantial data
        const hasSubstantialData = plan.event_date && plan.location;
        if (hasSubstantialData && goalAfter?.current_state === 'new_lead') {
            goalConsistent = false;
        }
    }

    // Check missing_fields recalculated
    const missingFields = plan.missing_fields;
    const fieldsFilled = Object.keys(requestedUpdates).filter(f =>
        requestedUpdates[f] !== undefined && requestedUpdates[f] !== null);
    const stillMissing = Array.isArray(missingFields)
        ? fieldsFilled.filter(f => missingFields.includes(f)) : [];

    return {
        verified: mismatches.length === 0,
        requested: requestedUpdates,
        persisted,
        rejected,
        mismatches,
        mismatch_count: mismatches.length,
        goalConsistent,
        missing_fields_recalculated: stillMissing.length === 0,
        still_missing_after_write: stillMissing,
        plan_confidence: plan.confidence,
        plan_status: plan.status
    };
}

function compareValues(requested, persisted, field) {
    if (persisted === null || persisted === undefined) return false;

    // Numeric fields
    const numericFields = ['children_count_estimate', 'duration_hours', 'animator_count', 'advance_amount'];
    if (numericFields.includes(field)) {
        return Number(requested) === Number(persisted);
    }

    // Date fields
    if (field === 'event_date') {
        const rDate = new Date(requested).toISOString().split('T')[0];
        const pDate = new Date(persisted).toISOString().split('T')[0];
        return rDate === pDate;
    }

    // Boolean fields
    if (field === 'invoice_requested') {
        return Boolean(requested) === Boolean(persisted);
    }

    // String comparison (case-insensitive for locations)
    if (field === 'location') {
        return String(requested).toLowerCase().trim() === String(persisted).toLowerCase().trim();
    }

    return String(requested) === String(persisted);
}
