import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } from '../config/env.mjs';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

/**
 * Shadow Analytics — Phase 3
 * 
 * Computes 20+ KPIs from ai_reply_decisions for shadow mode monitoring.
 * Used by rollout gate to decide wave eligibility.
 */

/**
 * Compute full shadow analytics for a time window.
 * @param {number} hours - lookback window in hours (default 24)
 * @returns {object} Full KPI report
 */
export async function computeShadowAnalytics(hours = 24) {
    const since = new Date(Date.now() - hours * 3600 * 1000).toISOString();

    // Fetch all decisions in window
    const { data: decisions, error } = await supabase
        .from('ai_reply_decisions')
        .select('id, conversation_id, confidence_score, safety_class, operator_verdict, operator_edited_reply, operator_feedback_at, reply_status, sent_by, sent_at, conversation_stage, tool_action_suggested, operational_mode, created_at')
        .gte('created_at', since)
        .order('created_at', { ascending: false });

    if (error) {
        console.error('[Analytics] Query error:', error.message);
        return { error: error.message };
    }

    const all = decisions || [];
    const shadow = all.filter(d => d.operational_mode === 'shadow_mode' || d.reply_status === 'shadow');
    const withFeedback = all.filter(d => d.operator_verdict);
    const total = all.length;
    const totalShadow = shadow.length;

    // ── Verdict breakdown ──
    const verdictCounts = {};
    const VERDICTS = ['approved_as_is', 'approved_with_edits', 'rejected', 'dangerous',
        'misunderstood_client', 'wrong_tool', 'should_have_clarified', 'unnecessary_question', 'wrong_memory_usage'];
    for (const v of VERDICTS) verdictCounts[v] = 0;
    for (const d of withFeedback) {
        if (d.operator_verdict && verdictCounts[d.operator_verdict] !== undefined) {
            verdictCounts[d.operator_verdict]++;
        }
    }
    const fbTotal = withFeedback.length || 1; // avoid /0

    // ── Safety class breakdown ──
    const safeCount = all.filter(d => d.safety_class === 'safe_autoreply_allowed').length;
    const reviewCount = all.filter(d => d.safety_class === 'needs_operator_review').length;
    const blockedCount = all.filter(d => d.safety_class === 'blocked_autoreply').length;

    // ── Confidence ──
    const confidences = all.map(d => d.confidence_score).filter(c => c != null);
    const avgConfidence = confidences.length > 0
        ? Math.round(confidences.reduce((s, c) => s + c, 0) / confidences.length) : 0;

    // ── Edit distance (approximate: edited replies vs suggested) ──
    const edited = withFeedback.filter(d => d.operator_edited_reply);
    const editDistances = edited.map(d => {
        const suggested = d.suggested_reply || '';
        const editedReply = d.operator_edited_reply || '';
        return Math.abs(suggested.length - editedReply.length);
    });
    const avgEditDistance = editDistances.length > 0
        ? Math.round(editDistances.reduce((s, d) => s + d, 0) / editDistances.length) : 0;

    // ── Duplicate outbound ──
    const sentDecisions = all.filter(d => d.reply_status === 'sent');
    const convSendCounts = {};
    for (const d of sentDecisions) {
        convSendCounts[d.conversation_id] = (convSendCounts[d.conversation_id] || 0) + 1;
    }
    const duplicateOutbound = Object.values(convSendCounts).filter(c => c > 1).length;

    // ── Double dispatch (multiple pipelines for same conv within 5s) ──
    const convTimestamps = {};
    for (const d of all) {
        if (!convTimestamps[d.conversation_id]) convTimestamps[d.conversation_id] = [];
        convTimestamps[d.conversation_id].push(new Date(d.created_at).getTime());
    }
    let doubleDispatch = 0;
    for (const times of Object.values(convTimestamps)) {
        times.sort();
        for (let i = 1; i < times.length; i++) {
            if (times[i] - times[i - 1] < 5000) doubleDispatch++;
        }
    }

    // ── Time to operator approval ──
    const approvalTimes = withFeedback
        .filter(d => d.operator_feedback_at && d.created_at)
        .map(d => (new Date(d.operator_feedback_at).getTime() - new Date(d.created_at).getTime()) / 1000);
    const avgApprovalTime = approvalTimes.length > 0
        ? Math.round(approvalTimes.reduce((s, t) => s + t, 0) / approvalTimes.length) : null;

    // ── Per-stage metrics ──
    const STAGES = ['new_lead', 'greeting', 'discovery', 'event_qualification', 'service_selection', 'package_recommendation'];
    const perStage = {};
    for (const stage of STAGES) {
        const stageDecisions = all.filter(d => d.conversation_stage === stage);
        const stageFeedback = stageDecisions.filter(d => d.operator_verdict);
        const stageApproved = stageFeedback.filter(d => ['approved_as_is', 'approved_with_edits'].includes(d.operator_verdict)).length;
        const stageTotal = stageFeedback.length || 1;
        perStage[stage] = {
            total: stageDecisions.length,
            with_feedback: stageFeedback.length,
            approval_rate: Math.round((stageApproved / stageTotal) * 100),
            avg_confidence: stageDecisions.length > 0
                ? Math.round(stageDecisions.reduce((s, d) => s + (d.confidence_score || 0), 0) / stageDecisions.length) : 0
        };
    }

    // ── Unique conversations ──
    const uniqueConvs = new Set(all.map(d => d.conversation_id)).size;

    return {
        window_hours: hours,
        since,
        total_decisions: total,
        total_shadow: totalShadow,
        unique_conversations: uniqueConvs,
        total_with_feedback: withFeedback.length,

        // Verdict rates (%)
        verdict_breakdown: {
            approved_as_is: Math.round((verdictCounts.approved_as_is / fbTotal) * 100),
            approved_with_edits: Math.round((verdictCounts.approved_with_edits / fbTotal) * 100),
            rejected: Math.round((verdictCounts.rejected / fbTotal) * 100),
            dangerous: Math.round((verdictCounts.dangerous / fbTotal) * 100),
            should_have_clarified: Math.round((verdictCounts.should_have_clarified / fbTotal) * 100),
            wrong_tool: Math.round((verdictCounts.wrong_tool / fbTotal) * 100),
            unnecessary_question: Math.round((verdictCounts.unnecessary_question / fbTotal) * 100),
            misunderstood_client: Math.round((verdictCounts.misunderstood_client / fbTotal) * 100),
            wrong_memory_usage: Math.round((verdictCounts.wrong_memory_usage / fbTotal) * 100),
        },
        verdict_counts: verdictCounts,

        // Approval rate (approved_as_is + approved_with_edits)
        approval_rate: Math.round(((verdictCounts.approved_as_is + verdictCounts.approved_with_edits) / fbTotal) * 100),
        edit_rate: Math.round((verdictCounts.approved_with_edits / fbTotal) * 100),

        // Safety class breakdown
        safety_breakdown: {
            safe_autoreply_allowed: safeCount,
            needs_operator_review: reviewCount,
            blocked_autoreply: blockedCount,
            safe_pct: total > 0 ? Math.round((safeCount / total) * 100) : 0,
            review_pct: total > 0 ? Math.round((reviewCount / total) * 100) : 0,
            blocked_pct: total > 0 ? Math.round((blockedCount / total) * 100) : 0,
        },

        // Confidence
        avg_confidence: avgConfidence,

        // Edit distance
        avg_edit_distance: avgEditDistance,

        // Duplicate / double dispatch
        duplicate_outbound: duplicateOutbound,
        double_dispatch: doubleDispatch,

        // Wrong memory usage
        wrong_memory_usage_count: verdictCounts.wrong_memory_usage,

        // Time to approval
        avg_time_to_approval_sec: avgApprovalTime,

        // Per-stage
        per_stage: perStage,
    };
}
