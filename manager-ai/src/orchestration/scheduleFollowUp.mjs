import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } from '../config/env.mjs';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const FOLLOW_UP_DELAY_MS = Number.parseInt(process.env.AI_FOLLOWUP_DELAY_MINUTES || '10', 10) * 60 * 1000;

/**
 * Schedule a deferred follow-up for a conversation.
 *
 * Safety: only one pending follow-up per conversation (enforced by unique index).
 * If one already exists, this is a no-op.
 *
 * @param {object} params
 * @param {string} params.conversationId
 * @param {string} params.followUpReason     - wait_for_more_messages | wait_for_missing_info
 * @param {boolean} params.openQuestionDetected
 * @param {boolean} params.customerIntentUnanswered
 * @param {string[]} params.missingFields
 * @param {string} [params.triggerMessageId]
 * @param {string} [params.nextStep]
 * @param {string} [params.lastCustomerMessageAt]
 * @returns {Promise<object>} { scheduled, reason }
 */
export async function scheduleFollowUp({
    conversationId,
    followUpReason,
    openQuestionDetected,
    customerIntentUnanswered,
    missingFields,
    triggerMessageId,
    nextStep,
    lastCustomerMessageAt
}) {
    const followUpAt = new Date(Date.now() + FOLLOW_UP_DELAY_MS).toISOString();

    try {
        // Clear any existing pending follow-up first (safety)
        await supabase
            .from('ai_deferred_followups')
            .update({ status: 'cleared', skip_reason: 'superseded_by_new', updated_at: new Date().toISOString() })
            .eq('conversation_id', conversationId)
            .eq('status', 'pending');

        const { error } = await supabase.from('ai_deferred_followups').insert({
            conversation_id: conversationId,
            follow_up_at: followUpAt,
            follow_up_reason: followUpReason,
            open_question_detected: openQuestionDetected || false,
            customer_intent_unanswered: customerIntentUnanswered || false,
            missing_fields: missingFields || [],
            last_unanswered_customer_message_at: lastCustomerMessageAt || new Date().toISOString(),
            trigger_message_id: triggerMessageId || null,
            next_step_at_schedule: nextStep || null,
            status: 'pending'
        });

        if (error) {
            // Unique constraint violation = already has pending follow-up
            if (error.code === '23505') {
                console.log(`[FollowUp] Already has pending follow-up for ${conversationId}. Skipping.`);
                return { scheduled: false, reason: 'already_pending' };
            }
            console.error('[FollowUp] Schedule error:', error.message);
            return { scheduled: false, reason: `db_error: ${error.message}` };
        }

        console.log(`[FollowUp] Scheduled for ${conversationId} at ${followUpAt} (reason=${followUpReason}, missing=${(missingFields||[]).join(',')})`);
        return { scheduled: true, reason: 'deferred_follow_up_scheduled' };

    } catch (err) {
        console.error('[FollowUp] Schedule exception:', err.message);
        return { scheduled: false, reason: `exception: ${err.message}` };
    }
}

/**
 * Clear any pending follow-up for a conversation.
 * Called when AI replies, escalates, or conversation state changes.
 *
 * @param {string} conversationId
 * @param {string} clearReason
 */
export async function clearFollowUp(conversationId, clearReason) {
    try {
        const { data } = await supabase
            .from('ai_deferred_followups')
            .update({
                status: 'cleared',
                skip_reason: clearReason,
                updated_at: new Date().toISOString()
            })
            .eq('conversation_id', conversationId)
            .eq('status', 'pending')
            .select('id');

        if (data && data.length > 0) {
            console.log(`[FollowUp] Cleared ${data.length} pending follow-up(s) for ${conversationId}: ${clearReason}`);
        }
        return { cleared: (data?.length || 0) > 0 };
    } catch (err) {
        console.error('[FollowUp] Clear exception:', err.message);
        return { cleared: false };
    }
}
