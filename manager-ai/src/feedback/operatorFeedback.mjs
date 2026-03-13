import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } from '../config/env.mjs';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

/**
 * Valid operator verdict values.
 */
export const OPERATOR_VERDICTS = [
    'approved_as_is',
    'approved_with_edits',
    'rejected',
    'dangerous',
    'misunderstood_client',
    'wrong_tool',
    'should_have_clarified',
    'unnecessary_question',
    'wrong_memory_usage'
];

/**
 * Save operator feedback for a reply decision.
 * 
 * @param {string} replyDecisionId - UUID of the ai_reply_decisions row
 * @param {string} verdict - one of OPERATOR_VERDICTS
 * @param {string|null} editedReply - operator's edited version of the reply
 * @param {string|null} reason - free text reason
 * @returns {object} { success, error }
 */
export async function saveOperatorFeedback(replyDecisionId, verdict, editedReply = null, reason = null) {
    if (!replyDecisionId) {
        return { success: false, error: 'Missing replyDecisionId' };
    }

    if (!OPERATOR_VERDICTS.includes(verdict)) {
        return { success: false, error: `Invalid verdict: "${verdict}". Valid: ${OPERATOR_VERDICTS.join(', ')}` };
    }

    const { error } = await supabase
        .from('ai_reply_decisions')
        .update({
            operator_verdict: verdict,
            operator_edited_reply: editedReply,
            operator_feedback_reason: reason,
            operator_feedback_at: new Date().toISOString()
        })
        .eq('id', replyDecisionId);

    if (error) {
        console.error('[Feedback] DB Error:', error.message);
        return { success: false, error: error.message };
    }

    console.log(`[Feedback] Saved for ${replyDecisionId}: verdict=${verdict}${editedReply ? ', edited' : ''}`);
    return { success: true };
}

/**
 * Get operator feedback statistics for a date range.
 * 
 * @param {string} startDate - ISO date string
 * @param {string} endDate - ISO date string
 * @returns {object} KPI stats
 */
export async function getOperatorFeedbackStats(startDate = null, endDate = null) {
    let query = supabase
        .from('ai_reply_decisions')
        .select('safety_class, operator_verdict, reply_status, confidence_score')
        .not('safety_class', 'is', null);

    if (startDate) query = query.gte('created_at', startDate);
    if (endDate) query = query.lte('created_at', endDate);

    const { data, error } = await query;
    if (error) {
        console.error('[Feedback] Stats error:', error.message);
        return { error: error.message };
    }

    const total = data.length;
    const withFeedback = data.filter(d => d.operator_verdict).length;
    const approved = data.filter(d => d.operator_verdict === 'approved_as_is').length;
    const edited = data.filter(d => d.operator_verdict === 'approved_with_edits').length;
    const rejected = data.filter(d => d.operator_verdict === 'rejected').length;
    const dangerous = data.filter(d => d.operator_verdict === 'dangerous').length;
    const safe = data.filter(d => d.safety_class === 'safe_autoreply_allowed').length;
    const review = data.filter(d => d.safety_class === 'needs_operator_review').length;
    const blocked = data.filter(d => d.safety_class === 'blocked_autoreply').length;

    return {
        total_decisions: total,
        with_feedback: withFeedback,
        safety_breakdown: { safe, review, blocked },
        verdict_breakdown: { approved, edited, rejected, dangerous },
        approval_rate: withFeedback > 0 ? Math.round(((approved + edited) / withFeedback) * 100) : 0,
        rejection_rate: withFeedback > 0 ? Math.round((rejected / withFeedback) * 100) : 0,
        avg_confidence: total > 0 ? Math.round(data.reduce((s, d) => s + (d.confidence_score || 0), 0) / total) : 0
    };
}
