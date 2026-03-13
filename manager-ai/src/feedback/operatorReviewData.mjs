import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } from '../config/env.mjs';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

/**
 * Operator Review Data Model — Phase 3
 * 
 * Assembles full review context for a single decision,
 * providing everything the operator needs to evaluate an AI reply.
 */
export async function getOperatorReviewData(decisionId) {
    // Get the decision
    const { data: dec, error } = await supabase
        .from('ai_reply_decisions')
        .select('*')
        .eq('id', decisionId)
        .single();

    if (error || !dec) {
        return { error: error?.message || 'Decision not found' };
    }

    // Get conversation details
    const { data: conv } = await supabase
        .from('conversations')
        .select('id, client_id, status, channel, session_id')
        .eq('id', dec.conversation_id)
        .single();

    // Get client info
    let clientInfo = null;
    if (conv?.client_id) {
        const { data: client } = await supabase
            .from('clients')
            .select('id, full_name, phone_number')
            .eq('id', conv.client_id)
            .single();
        clientInfo = client;
    }

    // Get event plan for this conversation
    const { data: plan } = await supabase
        .from('ai_event_plans')
        .select('id, status, event_date, location, requested_services, children_count_estimate, event_time, selected_package, confidence, missing_fields')
        .eq('conversation_id', dec.conversation_id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

    // Get latest quote
    const { data: quote } = await supabase
        .from('ai_quote_drafts')
        .select('id, status, total_amount, line_items, created_at')
        .eq('conversation_id', dec.conversation_id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

    // Get goal state
    const { data: goal } = await supabase
        .from('ai_goal_states')
        .select('current_state, previous_state, transition_count, updated_at')
        .eq('conversation_id', dec.conversation_id)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();

    // Get final sent reply (if any)
    const { data: sentMsg } = await supabase
        .from('messages')
        .select('content, created_at, sender_type')
        .eq('conversation_id', dec.conversation_id)
        .eq('direction', 'outbound')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

    // Compute diff between suggested and final sent
    const suggestedReply = dec.suggested_reply || '';
    const finalReply = dec.operator_edited_reply || sentMsg?.content || '';
    const replyDiff = suggestedReply === finalReply ? 'identical'
        : finalReply ? 'edited' : 'not_sent';

    // Parse memory context
    let memorySnapshot = null;
    try {
        memorySnapshot = typeof dec.memory_context_used === 'string'
            ? JSON.parse(dec.memory_context_used) : dec.memory_context_used;
    } catch { memorySnapshot = null; }

    return {
        decision_id: dec.id,
        conversation_id: dec.conversation_id,
        created_at: dec.created_at,

        // Reply comparison
        suggested_reply: suggestedReply,
        final_reply_sent: finalReply,
        reply_diff: replyDiff,

        // Tool action
        tool_action_suggested: dec.tool_action_suggested,
        tool_action_executed: dec.tool_action_executed,

        // Safety & confidence
        safety_class: dec.safety_class,
        safety_class_reasons: dec.safety_class_reasons,
        confidence_score: dec.confidence_score,
        operational_mode: dec.operational_mode,

        // Reply status
        reply_status: dec.reply_status,
        sent_by: dec.sent_by,
        sent_at: dec.sent_at,

        // Eligibility
        eligibility_status: dec.eligibility_status,
        eligibility_reason: dec.eligibility_reason,

        // Quality
        reply_quality_score: dec.reply_quality_score,
        reply_quality_label: dec.reply_quality_label,

        // Memory snapshot
        memory_snapshot: memorySnapshot,

        // Context: event plan
        active_event_plan: plan ? {
            id: plan.id, status: plan.status,
            event_date: plan.event_date, location: plan.location,
            services: plan.requested_services,
            children: plan.children_count_estimate,
            confidence: plan.confidence,
            missing: plan.missing_fields
        } : null,

        // Context: quote
        active_quote: quote ? {
            id: quote.id, status: quote.status,
            total: quote.total_amount,
            items: quote.line_items
        } : null,

        // Context: goal state
        goal_state: goal,

        // Context: recurring client
        recurring_client: memorySnapshot?.is_recurring || false,
        conversation_count: memorySnapshot?.conversation_count || 0,

        // Client info
        client: clientInfo,
        conversation_status: conv?.status,

        // Operator feedback
        operator_verdict: dec.operator_verdict,
        operator_edited_reply: dec.operator_edited_reply,
        operator_feedback_reason: dec.operator_feedback_reason,
        operator_feedback_at: dec.operator_feedback_at,

        // Rollout markers
        rollout_eligibility: {
            is_safe_for_autoreply: dec.safety_class === 'safe_autoreply_allowed',
            needs_review: dec.safety_class === 'needs_operator_review',
            is_blocked: dec.safety_class === 'blocked_autoreply',
        }
    };
}
