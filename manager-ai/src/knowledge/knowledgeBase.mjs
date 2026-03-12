/**
 * Knowledge Base Lookup
 *
 * Searches the ai_knowledge_base table for matching answers
 * BEFORE calling the LLM. If a match is found, returns the
 * verified answer directly (fast path, no LLM needed).
 *
 * Matching strategy:
 *  1. Normalize client message (lowercase, strip diacritics)
 *  2. Check each active KB entry's question_patterns
 *  3. Score by keyword overlap
 *  4. Return best match above threshold
 */

import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } from '../config/env.mjs';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// Cache KB entries (reload every 5 min)
let kbCache = null;
let kbCacheAt = 0;
const KB_CACHE_TTL = 5 * 60 * 1000;

/**
 * Normalize text: lowercase, strip diacritics, remove punctuation
 */
function normalize(text) {
    return (text || '')
        .toLowerCase()
        .replace(/ă/g, 'a').replace(/â/g, 'a').replace(/î/g, 'i')
        .replace(/ș/g, 's').replace(/ş/g, 's')
        .replace(/ț/g, 't').replace(/ţ/g, 't')
        .replace(/[^a-z0-9\s]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Load KB entries (cached)
 */
async function loadKB() {
    if (kbCache && (Date.now() - kbCacheAt) < KB_CACHE_TTL) {
        return kbCache;
    }

    const { data, error } = await supabase
        .from('ai_knowledge_base')
        .select('*')
        .eq('active', true)
        .order('times_used', { ascending: false });

    if (error) {
        console.error('[KB] Load error:', error.message);
        return kbCache || [];
    }

    kbCache = data || [];
    kbCacheAt = Date.now();
    console.log(`[KB] Loaded ${kbCache.length} active entries`);
    return kbCache;
}

/**
 * Score how well a message matches a KB entry's patterns.
 * Returns 0-1 score.
 */
function scoreMatch(normalizedMsg, patterns) {
    let bestScore = 0;

    for (const pattern of patterns) {
        const normPattern = normalize(pattern);
        const patternWords = normPattern.split(' ').filter(w => w.length > 2);

        if (patternWords.length === 0) continue;

        // Check if message contains the full pattern
        if (normalizedMsg.includes(normPattern)) {
            bestScore = Math.max(bestScore, 1.0);
            continue;
        }

        // Count matching words
        let matchCount = 0;
        for (const word of patternWords) {
            if (normalizedMsg.includes(word)) matchCount++;
        }

        const wordScore = matchCount / patternWords.length;
        bestScore = Math.max(bestScore, wordScore);
    }

    return bestScore;
}

/**
 * Search Knowledge Base for a matching answer.
 *
 * @param {string} clientMessage - The client's message
 * @param {object} [options]
 * @param {string} [options.category] - Filter by category
 * @param {number} [options.minScore] - Minimum match score (default: 0.6)
 * @returns {object|null} { answer, category, score, kbId, metadata } or null
 */
export async function searchKnowledgeBase(clientMessage, options = {}) {
    const minScore = options.minScore || 0.6;
    const entries = await loadKB();

    if (entries.length === 0) return null;

    const normMsg = normalize(clientMessage);

    // Don't search for very short messages (acks, greetings)
    if (normMsg.length < 8) return null;

    let bestMatch = null;
    let bestScore = 0;

    for (const entry of entries) {
        if (options.category && entry.category !== options.category) continue;

        const score = scoreMatch(normMsg, entry.question_patterns || []);
        if (score > bestScore && score >= minScore) {
            bestScore = score;
            bestMatch = entry;
        }
    }

    if (!bestMatch) return null;

    // Increment usage counter (fire-and-forget)
    supabase.from('ai_knowledge_base')
        .update({
            times_used: (bestMatch.times_used || 0) + 1,
            updated_at: new Date().toISOString()
        })
        .eq('id', bestMatch.id)
        .then(() => {})
        .catch(() => {});

    console.log(`[KB] Match found: score=${bestScore.toFixed(2)}, category=${bestMatch.category}, id=${bestMatch.id}`);

    return {
        answer: bestMatch.answer,
        category: bestMatch.category,
        score: bestScore,
        kbId: bestMatch.id,
        metadata: bestMatch.metadata || {}
    };
}

/**
 * Invalidate the KB cache (call after admin updates)
 */
export function invalidateKBCache() {
    kbCache = null;
    kbCacheAt = 0;
}
