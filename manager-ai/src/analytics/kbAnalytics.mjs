/**
 * KB Analytics — queryable reports for observability
 *
 * Reports:
 *  - pathDistribution(hours)  — KB direct vs grounded vs LLM fallback
 *  - topKbHits(limit)         — most used KB entries
 *  - topNoMatchQueries(limit) — questions with no KB match (gap analysis)
 *  - topCandidates(limit)     — learned correction candidates
 *  - decisionDistribution(hours) — reply/wait/silence/escalate breakdown
 */

import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } from '../config/env.mjs';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

/**
 * Path distribution: KB direct vs KB grounded vs LLM fallback
 */
export async function pathDistribution(hours = 24) {
    const since = new Date(Date.now() - hours * 3600 * 1000).toISOString();

    const { data, error } = await supabase
        .from('ai_analytics_events')
        .select('event_type')
        .in('event_type', ['kb_direct_answer_used', 'kb_grounded_composer_used', 'llm_fallback_used'])
        .gte('created_at', since);

    if (error) return { error: error.message };

    const counts = { kb_direct_answer: 0, kb_grounded_composer: 0, llm_fallback: 0 };
    for (const e of (data || [])) {
        if (e.event_type === 'kb_direct_answer_used') counts.kb_direct_answer++;
        else if (e.event_type === 'kb_grounded_composer_used') counts.kb_grounded_composer++;
        else counts.llm_fallback++;
    }

    const total = counts.kb_direct_answer + counts.kb_grounded_composer + counts.llm_fallback;
    return {
        ...counts,
        total,
        kb_rate: total > 0 ? ((counts.kb_direct_answer + counts.kb_grounded_composer) / total * 100).toFixed(1) + '%' : '0%',
        period: `${hours}h`
    };
}

/**
 * Decision distribution: reply/wait/silence/escalate
 */
export async function decisionDistribution(hours = 24) {
    const since = new Date(Date.now() - hours * 3600 * 1000).toISOString();

    const types = [
        'decision_reply_now', 'decision_wait_for_more_messages',
        'decision_wait_for_missing_info', 'decision_stay_silent',
        'decision_escalate', 'blocked_human_takeover', 'blocked_duplicate',
        'blocked_cooldown', 'blocked_closing_signal', 'blocked_customer_paused'
    ];

    const { data, error } = await supabase
        .from('ai_analytics_events')
        .select('event_type')
        .in('event_type', types)
        .gte('created_at', since);

    if (error) return { error: error.message };

    const counts = {};
    for (const t of types) counts[t] = 0;
    for (const e of (data || [])) counts[e.event_type]++;

    return { ...counts, period: `${hours}h` };
}

/**
 * Top KB hits — most used knowledge base entries
 */
export async function topKbHits(limit = 10) {
    const { data, error } = await supabase
        .from('ai_knowledge_base')
        .select('knowledge_key, category, service_tags, times_used')
        .eq('active', true)
        .eq('approval_status', 'approved')
        .order('times_used', { ascending: false })
        .limit(limit);

    return error ? { error: error.message } : data;
}

/**
 * Top no-match queries — questions that fell through to LLM (KB gaps)
 */
export async function topNoMatchQueries(limit = 20, hours = 72) {
    const since = new Date(Date.now() - hours * 3600 * 1000).toISOString();

    const { data, error } = await supabase
        .from('ai_kb_misses')
        .select('client_message, best_score, detected_services, created_at')
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(limit);

    return error ? { error: error.message } : data;
}

/**
 * Top learned correction candidates (backlog for review)
 */
export async function topCandidates(limit = 20) {
    const { data, error } = await supabase
        .from('ai_learned_corrections')
        .select('id, corrected_reply, question_context, correction_scope, service_tags, times_seen, kb_candidate_status, created_at')
        .eq('kb_candidate_status', 'candidate')
        .order('times_seen', { ascending: false })
        .limit(limit);

    return error ? { error: error.message } : data;
}

/**
 * Follow-up analytics
 */
export async function followUpStats(hours = 24) {
    const since = new Date(Date.now() - hours * 3600 * 1000).toISOString();

    const types = [
        'deferred_follow_up_scheduled', 'deferred_follow_up_triggered',
        'deferred_follow_up_sent', 'deferred_follow_up_skipped_new_message',
        'deferred_follow_up_skipped_ai_already_replied',
        'deferred_follow_up_skipped_human_takeover',
        'deferred_follow_up_skipped_blocked_state'
    ];

    const { data, error } = await supabase
        .from('ai_analytics_events')
        .select('event_type')
        .in('event_type', types)
        .gte('created_at', since);

    if (error) return { error: error.message };

    const counts = {};
    for (const t of types) counts[t.replace('deferred_follow_up_', '')] = 0;
    for (const e of (data || [])) counts[e.event_type.replace('deferred_follow_up_', '')]++;

    return { ...counts, period: `${hours}h` };
}
