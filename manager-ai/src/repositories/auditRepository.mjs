import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } from '../config/env.mjs';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

/**
 * Audit summary for the last N hours.
 * Returns eligibility breakdown, reply status distribution, stage distribution, confidence buckets.
 */
export async function getAuditSummary(hoursBack = 24) {
    const since = new Date(Date.now() - hoursBack * 3600 * 1000).toISOString();

    const { data: decisions, error } = await supabase
        .from('ai_reply_decisions')
        .select('eligibility_status, eligibility_reason, reply_status, sent_by, conversation_stage, confidence_score, can_auto_reply, needs_human_review, cycle_status, cycle_reason, reply_quality_score, reply_quality_label, reply_style, composer_used')
        .gte('created_at', since)
        .order('created_at', { ascending: false });

    if (error) return { error: error.message };
    if (!decisions || decisions.length === 0) return { total: 0, period_hours: hoursBack, message: 'Nicio decizie in aceasta perioada.' };

    // Eligibility breakdown
    const eligibility = {};
    decisions.forEach(d => {
        const reason = d.eligibility_reason || 'unknown';
        eligibility[reason] = (eligibility[reason] || 0) + 1;
    });

    // Reply status breakdown
    const replyStatus = {};
    decisions.forEach(d => {
        const key = d.reply_status || 'unknown';
        replyStatus[key] = (replyStatus[key] || 0) + 1;
    });

    // Sent by breakdown
    const sentBy = {};
    decisions.forEach(d => {
        const key = d.sent_by || 'none';
        sentBy[key] = (sentBy[key] || 0) + 1;
    });

    // Stage distribution
    const stages = {};
    decisions.forEach(d => {
        const key = d.conversation_stage || 'unknown';
        stages[key] = (stages[key] || 0) + 1;
    });

    // Confidence score buckets
    const confidenceBuckets = { '0-25': 0, '26-50': 0, '51-75': 0, '76-100': 0 };
    decisions.forEach(d => {
        const score = d.confidence_score || 0;
        if (score <= 25) confidenceBuckets['0-25']++;
        else if (score <= 50) confidenceBuckets['26-50']++;
        else if (score <= 75) confidenceBuckets['51-75']++;
        else confidenceBuckets['76-100']++;
    });

    // Eligible vs blocked
    const eligible = decisions.filter(d => d.eligibility_status === 'eligible').length;
    const blocked = decisions.filter(d => d.eligibility_status === 'blocked').length;

    // Cycle status distribution
    const cycleDistribution = {};
    decisions.forEach(d => {
        const key = d.cycle_status || 'unknown';
        cycleDistribution[key] = (cycleDistribution[key] || 0) + 1;
    });

    // Cycle reason distribution
    const cycleReasons = {};
    decisions.forEach(d => {
        const key = d.cycle_reason || 'unknown';
        cycleReasons[key] = (cycleReasons[key] || 0) + 1;
    });

    return {
        total: decisions.length,
        period_hours: hoursBack,
        since,
        eligibility_summary: { eligible, blocked },
        eligibility_reasons: eligibility,
        cycle_distribution: cycleDistribution,
        cycle_reasons: cycleReasons,
        quality_distribution: (() => {
            const qd = {};
            decisions.forEach(d => {
                const key = d.reply_quality_label || 'unknown';
                qd[key] = (qd[key] || 0) + 1;
            });
            return qd;
        })(),
        reply_status: replyStatus,
        sent_by: sentBy,
        stage_distribution: stages,
        confidence_buckets: confidenceBuckets
    };
}

/**
 * Recent decisions — last N entries with key fields.
 */
export async function getRecentDecisions(limit = 20) {
    const { data, error } = await supabase
        .from('ai_reply_decisions')
        .select(`
            id, conversation_id, 
            eligibility_status, eligibility_reason,
            can_auto_reply, needs_human_review,
            confidence_score, conversation_stage,
            reply_status, sent_by, sent_at,
            suggested_reply, operator_prompt, operator_edit,
            cycle_status, cycle_reason,
            created_at
        `)
        .order('created_at', { ascending: false })
        .limit(limit);

    if (error) return { error: error.message };
    return { count: data?.length || 0, decisions: data || [] };
}

/**
 * Full diagnostic for a single conversation.
 * Returns: latest decision, conversation state, entity memory, event draft, latest schema components.
 */
export async function getConversationDiagnostic(conversationId) {
    // Latest decision
    const { data: decision } = await supabase
        .from('ai_reply_decisions')
        .select('*')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

    // Conversation state
    const { data: state } = await supabase
        .from('ai_conversation_state')
        .select('*')
        .eq('conversation_id', conversationId)
        .maybeSingle();

    // Entity memory (via conversation -> client_id)
    const { data: conv } = await supabase
        .from('conversations')
        .select('client_id, created_at')
        .eq('id', conversationId)
        .maybeSingle();

    let entityMemory = null;
    if (conv?.client_id) {
        const { data: mem } = await supabase
            .from('ai_client_memory')
            .select('memory_json, priority_level, internal_notes_summary, updated_at')
            .eq('client_id', conv.client_id)
            .maybeSingle();
        entityMemory = mem;
    }

    // Event draft
    const { data: draft } = await supabase
        .from('ai_event_drafts')
        .select('draft_type, structured_data_json, missing_fields_json, confidence_score, updated_at')
        .eq('conversation_id', conversationId)
        .maybeSingle();

    // Latest schema component types
    const { data: schema } = await supabase
        .from('ai_ui_schemas')
        .select('layout_json, generated_at')
        .eq('conversation_id', conversationId)
        .order('generated_at', { ascending: false })
        .limit(1)
        .maybeSingle();

    const schemaComponents = schema?.layout_json?.map(c => c.type) || [];

    // Decision history (last 5)
    const { data: history } = await supabase
        .from('ai_reply_decisions')
        .select('eligibility_status, eligibility_reason, confidence_score, reply_status, sent_by, cycle_status, cycle_reason, created_at')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: false })
        .limit(5);

    return {
        conversation_id: conversationId,
        conversation_created_at: conv?.created_at || null,
        latest_decision: decision ? {
            eligibility_status: decision.eligibility_status,
            eligibility_reason: decision.eligibility_reason,
            can_auto_reply: decision.can_auto_reply,
            needs_human_review: decision.needs_human_review,
            confidence_score: decision.confidence_score,
            conversation_stage: decision.conversation_stage,
            reply_status: decision.reply_status,
            sent_by: decision.sent_by,
            sent_at: decision.sent_at,
            suggested_reply: decision.suggested_reply,
            operator_prompt: decision.operator_prompt,
            operator_edit: decision.operator_edit,
            cycle_status: decision.cycle_status,
            cycle_reason: decision.cycle_reason,
            created_at: decision.created_at
        } : null,
        conversation_state: state ? {
            current_intent: state.current_intent,
            current_stage: state.current_stage,
            next_best_action: state.next_best_action,
            last_processed_message_id: state.last_processed_message_id,
            updated_at: state.updated_at
        } : null,
        entity_memory: entityMemory ? {
            entity_type: entityMemory.memory_json?.entity_type || 'unknown',
            entity_confidence: entityMemory.memory_json?.entity_confidence || 0,
            usual_locations: entityMemory.memory_json?.usual_locations || [],
            usual_services: entityMemory.memory_json?.usual_services || [],
            behavior_patterns: entityMemory.memory_json?.behavior_patterns || [],
            priority_level: entityMemory.priority_level,
            notes_summary: entityMemory.internal_notes_summary,
            last_updated: entityMemory.updated_at
        } : null,
        event_draft: draft || null,
        schema_components: schemaComponents,
        decision_history: history || []
    };
}
