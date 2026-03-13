import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } from '../config/env.mjs';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

/**
 * Memory Conflict Detector — Phase 5
 * 
 * Detects 7 conflict types between memory, event plan, booking, quote, and current request.
 * Returns { hasConflict, severity, conflicts[], recommendation }
 */

/**
 * @param {object} params
 * @returns {{ hasConflict: boolean, severity: string, conflicts: object[], recommendation: string }}
 */
export async function detectMemoryConflicts({
    conversationId,
    clientId,
    proposedUpdates,
    eventPlan,
    goalState,
    relationshipData,
    entityMemory
}) {
    const conflicts = [];

    // 1. Multiple active plans ambiguity
    const { data: plans } = await supabase
        .from('ai_event_plans')
        .select('id, status, event_date, location, created_at')
        .eq('conversation_id', conversationId)
        .in('status', ['draft', 'active', 'quote_ready'])
        .order('created_at', { ascending: false });

    if (plans && plans.length > 1) {
        conflicts.push({
            type: 'multiple_active_plans',
            severity: 'high',
            detail: `${plans.length} active plans found`,
            plan_ids: plans.map(p => p.id)
        });
    }

    // 2. Booking vs new request conflict
    if (relationshipData?.hasActiveBooking && proposedUpdates) {
        const sensitiveFields = ['event_date', 'location', 'selected_package'];
        const touchesSensitive = sensitiveFields.some(f => proposedUpdates[f] !== undefined);
        if (touchesSensitive) {
            conflicts.push({
                type: 'booking_conflict',
                severity: 'critical',
                detail: 'Active booking exists and update touches sensitive fields',
                fields: sensitiveFields.filter(f => proposedUpdates[f] !== undefined)
            });
        }
    }

    // 3. Field overwrite conflict — contradicts confirmed fields
    if (eventPlan?.confirmed_fields && proposedUpdates) {
        const confirmed = typeof eventPlan.confirmed_fields === 'string'
            ? JSON.parse(eventPlan.confirmed_fields) : eventPlan.confirmed_fields;
        if (Array.isArray(confirmed)) {
            for (const field of confirmed) {
                if (proposedUpdates[field] !== undefined && eventPlan[field] !== undefined
                    && String(proposedUpdates[field]) !== String(eventPlan[field])) {
                    conflicts.push({
                        type: 'field_overwrite',
                        severity: 'medium',
                        detail: `Overwriting confirmed field: ${field}`,
                        field,
                        current: eventPlan[field],
                        proposed: proposedUpdates[field]
                    });
                }
            }
        }
    }

    // 4. Archived/cancelled plan target
    if (eventPlan && ['archived', 'cancelled', 'hidden'].includes(eventPlan.status)) {
        conflicts.push({
            type: 'invalid_plan_status',
            severity: 'critical',
            detail: `Plan status is ${eventPlan.status}`,
            plan_id: eventPlan.id
        });
    }

    // 5. Operator lock
    if (eventPlan?.operator_locked) {
        conflicts.push({
            type: 'operator_lock',
            severity: 'critical',
            detail: 'Plan is locked by operator'
        });
    }

    // 6. Quote inconsistency — quote exists but update changes foundation
    const { data: activeQuote } = await supabase
        .from('ai_quote_drafts')
        .select('id, status, total_amount')
        .eq('conversation_id', conversationId)
        .in('status', ['draft', 'sent', 'accepted'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

    if (activeQuote && proposedUpdates) {
        const quoteBreakers = ['selected_package', 'children_count_estimate', 'duration_hours'];
        const breaksQuote = quoteBreakers.some(f => proposedUpdates[f] !== undefined);
        if (breaksQuote) {
            conflicts.push({
                type: 'quote_inconsistency',
                severity: 'medium',
                detail: 'Update changes fields that affect existing quote',
                quote_id: activeQuote.id,
                fields: quoteBreakers.filter(f => proposedUpdates[f] !== undefined)
            });
        }
    }

    // 7. Context drift — proposed date in the past
    if (proposedUpdates?.event_date) {
        const proposed = new Date(proposedUpdates.event_date);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        if (proposed < today) {
            conflicts.push({
                type: 'context_drift',
                severity: 'high',
                detail: `Proposed date ${proposedUpdates.event_date} is in the past`
            });
        }
    }

    // Determine overall severity and recommendation
    const severities = conflicts.map(c => c.severity);
    const maxSeverity = severities.includes('critical') ? 'critical'
        : severities.includes('high') ? 'high'
        : severities.includes('medium') ? 'medium' : 'low';

    const recommendation = maxSeverity === 'critical' ? 'block_autoreply'
        : maxSeverity === 'high' ? 'require_operator_review'
        : conflicts.length > 0 ? 'require_clarification'
        : 'allow';

    return {
        hasConflict: conflicts.length > 0,
        severity: maxSeverity,
        conflicts,
        recommendation,
        conflict_count: conflicts.length
    };
}
