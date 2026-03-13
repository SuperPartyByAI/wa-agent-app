import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } from '../config/env.mjs';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

/**
 * Load relationship data for a client — conversation count, event plan history,
 * active bookings, past cancellations, last interaction date.
 * 
 * Returns structured data for the relationship memory prompt block.
 * 
 * @param {string} clientId
 * @returns {object|null} relationship data or null if unknown client
 */
export async function loadRelationshipData(clientId) {
    if (!clientId) return null;

    try {
        // Count conversations for this client
        const { count: conversationCount } = await supabase
            .from('conversations')
            .select('id', { count: 'exact', head: true })
            .eq('client_id', clientId);

        // Count event plans (all statuses)
        const { count: eventPlanCount } = await supabase
            .from('ai_event_plans')
            .select('id', { count: 'exact', head: true })
            .eq('client_id', clientId);

        // Check for active booking (booking_ready or confirmed plans)
        const { data: activeBookings } = await supabase
            .from('ai_event_plans')
            .select('id, status')
            .eq('client_id', clientId)
            .in('status', ['booking_ready', 'active'])
            .limit(1);

        // Check for past completed/archived plans
        const { data: pastPlans } = await supabase
            .from('ai_event_plans')
            .select('id, status')
            .eq('client_id', clientId)
            .in('status', ['archived', 'cancelled'])
            .limit(1);

        // Last interaction: most recent conversation's last message
        const { data: lastConv } = await supabase
            .from('conversations')
            .select('updated_at')
            .eq('client_id', clientId)
            .order('updated_at', { ascending: false })
            .limit(1)
            .maybeSingle();

        const result = {
            conversationCount: conversationCount || 0,
            eventPlanCount: eventPlanCount || 0,
            hasActiveBooking: (activeBookings?.length || 0) > 0,
            hasPastBookings: (pastPlans?.some(p => p.status === 'archived') || false),
            hasPastCancellations: (pastPlans?.some(p => p.status === 'cancelled') || false),
            lastInteractionAt: lastConv?.updated_at
                ? new Date(lastConv.updated_at).toLocaleDateString('ro-RO')
                : null,
            isRecurring: (conversationCount || 0) > 1
        };

        console.log(`[RelationshipMemory] Client ${clientId}: convs=${result.conversationCount}, plans=${result.eventPlanCount}, activeBooking=${result.hasActiveBooking}, recurring=${result.isRecurring}`);
        return result;
    } catch (err) {
        console.warn('[RelationshipMemory] Error loading relationship data:', err.message);
        return null;
    }
}
