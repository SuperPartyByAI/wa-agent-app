import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } from '../config/env.mjs';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

/**
 * Operator Scorecard — Phase 4
 * 
 * 16 KPIs aggregated per: overall, stage, cohort, time window.
 */

/**
 * Compute operator scorecard.
 * @param {object} opts - { hours, stage, groupBy }
 * @returns {object} Scorecard
 */
export async function computeScorecard({ hours = 24, stage = null, groupBy = 'overall' } = {}) {
    const since = new Date(Date.now() - hours * 3600 * 1000).toISOString();

    let query = supabase
        .from('ai_reply_decisions')
        .select('id, conversation_id, confidence_score, safety_class, operator_verdict, operator_edited_reply, reply_status, sent_by, conversation_stage, tool_action_suggested, operational_mode, created_at, sent_at')
        .gte('created_at', since);

    if (stage) query = query.eq('conversation_stage', stage);

    const { data: decisions, error } = await query.order('created_at', { ascending: false });
    if (error) return { error: error.message };

    const all = decisions || [];
    const autoSent = all.filter(d => d.reply_status === 'sent' && d.sent_by === 'ai');
    const shadowed = all.filter(d => d.reply_status === 'shadow');
    const withFeedback = all.filter(d => d.operator_verdict);
    const fbTotal = withFeedback.length || 1;

    // Verdict counts
    const vCounts = {};
    for (const d of withFeedback) {
        vCounts[d.operator_verdict] = (vCounts[d.operator_verdict] || 0) + 1;
    }

    const approved = (vCounts.approved_as_is || 0) + (vCounts.approved_with_edits || 0);

    // Response latency (created_at to sent_at for auto-sent)
    const latencies = autoSent
        .filter(d => d.sent_at && d.created_at)
        .map(d => (new Date(d.sent_at).getTime() - new Date(d.created_at).getTime()) / 1000);
    const avgLatency = latencies.length > 0
        ? Math.round(latencies.reduce((s, l) => s + l, 0) / latencies.length) : null;

    // Confidence
    const confidences = all.map(d => d.confidence_score).filter(c => c != null);
    const avgConfidence = confidences.length > 0
        ? Math.round(confidences.reduce((s, c) => s + c, 0) / confidences.length) : 0;

    // Rollback count (from rollout state history)
    const { data: rollbacks } = await supabase
        .from('ai_rollout_state')
        .select('id')
        .eq('changed_by', 'system_rollback')
        .gte('created_at', since);

    // Blocked autoreplies
    const blocked = all.filter(d => d.safety_class === 'blocked_autoreply').length;

    // Escalated
    const escalated = all.filter(d => d.reply_status === 'escalated' ||
        (d.operator_verdict === 'dangerous')).length;

    // Duplicate check
    const convSendCounts = {};
    for (const d of autoSent) {
        convSendCounts[d.conversation_id] = (convSendCounts[d.conversation_id] || 0) + 1;
    }
    const duplicates = Object.values(convSendCounts).filter(c => c > 1).length;

    // Per-stage breakdown (if groupBy === 'stage')
    let stageBreakdown = null;
    if (groupBy === 'stage') {
        const STAGES = ['new_lead', 'greeting', 'discovery', 'event_qualification', 'service_selection', 'package_recommendation'];
        stageBreakdown = {};
        for (const s of STAGES) {
            const stageAll = all.filter(d => d.conversation_stage === s);
            const stageSent = stageAll.filter(d => d.reply_status === 'sent' && d.sent_by === 'ai');
            const stageFb = stageAll.filter(d => d.operator_verdict);
            const stageApproved = stageFb.filter(d => ['approved_as_is', 'approved_with_edits'].includes(d.operator_verdict)).length;
            stageBreakdown[s] = {
                total: stageAll.length,
                auto_sent: stageSent.length,
                with_feedback: stageFb.length,
                approval_rate: stageFb.length > 0 ? Math.round((stageApproved / stageFb.length) * 100) : 0,
                avg_confidence: stageAll.length > 0
                    ? Math.round(stageAll.reduce((sum, d) => sum + (d.confidence_score || 0), 0) / stageAll.length) : 0
            };
        }
    }

    return {
        window_hours: hours,
        since,
        group_by: groupBy,
        stage_filter: stage,

        // 16 KPIs
        total_replies_auto_sent: autoSent.length,
        total_replies_shadowed: shadowed.length,
        total_decisions: all.length,
        approval_rate: Math.round((approved / fbTotal) * 100),
        edit_rate: Math.round(((vCounts.approved_with_edits || 0) / fbTotal) * 100),
        dangerous_rate: Math.round(((vCounts.dangerous || 0) / fbTotal) * 100),
        wrong_tool_rate: Math.round(((vCounts.wrong_tool || 0) / fbTotal) * 100),
        misunderstood_client_rate: Math.round(((vCounts.misunderstood_client || 0) / fbTotal) * 100),
        should_have_clarified_rate: Math.round(((vCounts.should_have_clarified || 0) / fbTotal) * 100),
        unnecessary_question_rate: Math.round(((vCounts.unnecessary_question || 0) / fbTotal) * 100),
        wrong_memory_usage_rate: Math.round(((vCounts.wrong_memory_usage || 0) / fbTotal) * 100),
        average_confidence: avgConfidence,
        average_response_latency_sec: avgLatency,
        duplicate_outbound: duplicates,
        rollback_trigger_count: rollbacks?.length || 0,
        blocked_autoreplies: blocked,
        escalated_conversations: escalated,

        // Breakdowns
        verdict_counts: vCounts,
        stage_breakdown: stageBreakdown,
    };
}
