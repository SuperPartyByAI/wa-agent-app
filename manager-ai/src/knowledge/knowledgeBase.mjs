/**
 * Knowledge Base — public API wrapping knowledgeMatcher
 *
 * Exposes:
 *  - searchKnowledgeBase(msg, context)  — main lookup
 *  - getLearningContext(msg, context)    — get learned corrections as LLM context
 *  - invalidateKBCache()                — flush cache
 */

import { matchKnowledge, invalidateKBCache as flushCache } from './knowledgeMatcher.mjs';
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } from '../config/env.mjs';
import { normalize } from './knowledgeMatcher.mjs';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

/**
 * Search Knowledge Base.
 * Delegates to knowledgeMatcher for service-aware, score-based retrieval.
 *
 * @param {string} clientMessage
 * @param {object} [context]
 * @param {string[]} [context.detectedServices]
 * @param {string}   [context.conversationStage]
 * @returns {object|null} Match result or null
 */
export async function searchKnowledgeBase(clientMessage, context = {}) {
    return matchKnowledge(clientMessage, context);
}

/**
 * Get learned corrections relevant to a question as supplementary LLM context.
 * Returns the best matching *approved* or *candidate* corrections (not auto-used).
 *
 * @param {string} clientMessage
 * @param {object} [context]
 * @param {string[]} [context.serviceTags]
 * @returns {object[]} Array of { correctedReply, questionContext, scope, timeSeen }
 */
export async function getLearningContext(clientMessage, context = {}) {
    const normMsg = normalize(clientMessage);
    if (normMsg.length < 8) return [];

    const { data, error } = await supabase
        .from('ai_learned_corrections')
        .select('corrected_reply, question_context, correction_scope, times_seen, service_tags')
        .in('correction_scope', ['factual', 'pricing', 'policy', 'service_info'])
        .gte('times_seen', 2)  // at least 2 occurrences
        .order('times_seen', { ascending: false })
        .limit(20);

    if (error || !data || data.length === 0) return [];

    // Score each correction's relevance to current message
    const scored = data.map(c => {
        const normQ = normalize(c.question_context || '');
        const words = normQ.split(' ').filter(w => w.length > 2);
        let hits = 0;
        for (const w of words) {
            if (normMsg.includes(w)) hits++;
        }
        const qScore = words.length > 0 ? hits / words.length : 0;

        // Service match bonus
        let svcBonus = 0;
        if (context.serviceTags && c.service_tags) {
            const det = new Set(context.serviceTags);
            if (c.service_tags.some(t => det.has(t))) svcBonus = 0.3;
        }

        return { ...c, relevance: qScore + svcBonus };
    });

    return scored
        .filter(s => s.relevance > 0.3)
        .sort((a, b) => b.relevance - a.relevance)
        .slice(0, 3)
        .map(s => ({
            correctedReply: s.corrected_reply,
            questionContext: s.question_context,
            scope: s.correction_scope,
            timesSeen: s.times_seen
        }));
}

/**
 * Invalidate KB cache (call after admin updates KB)
 */
export function invalidateKBCache() {
    flushCache();
}
