/**
 * Learning Loop — Capture operator corrections with proper review workflow
 *
 * Safety rules:
 *  - Only learns from HUMAN corrections, never from AI output
 *  - Classifies correction scope (factual, pricing, policy, tone, etc.)
 *  - Only factual/pricing/policy/service_info scopes are KB-eligible
 *  - 3+ similar corrections → candidate status (NOT auto-activated)
 *  - KB activation requires explicit review/approval
 *  - Operator takeover (no AI reply to compare) is NOT treated as correction
 */

import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } from '../config/env.mjs';
import { normalize } from './knowledgeMatcher.mjs';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const CANDIDATE_THRESHOLD = 3;  // corrections needed to become candidate

// Scopes eligible for KB promotion
const KB_ELIGIBLE_SCOPES = ['factual', 'pricing', 'policy', 'service_info'];

// Keywords that hint at correction scope
const SCOPE_HINTS = {
    pricing: ['pret', 'lei', 'cost', 'tarif', 'oferta', 'discount', 'pachet'],
    policy: ['regul', 'politic', 'anula', 'ramburs', 'conditii', 'termen'],
    service_info: ['servic', 'animator', 'balon', 'popcorn', 'vata', 'ursitoare', 'facepainting'],
    factual: ['adresa', 'program', 'orar', 'contact', 'zona', 'locati']
};

/**
 * Jaccard word-based similarity (0-1)
 */
function textSimilarity(a, b) {
    const wordsA = new Set(normalize(a).split(' ').filter(w => w.length > 2));
    const wordsB = new Set(normalize(b).split(' ').filter(w => w.length > 2));
    if (wordsA.size === 0 && wordsB.size === 0) return 1;
    if (wordsA.size === 0 || wordsB.size === 0) return 0;
    const intersection = [...wordsA].filter(w => wordsB.has(w)).length;
    const union = new Set([...wordsA, ...wordsB]).size;
    return intersection / union;
}

/**
 * Classify correction scope based on content analysis.
 * Returns: factual | pricing | policy | service_info | tone | clarity | sales_style
 */
function classifyScope(originalReply, correctedReply, questionContext) {
    const allText = normalize([originalReply, correctedReply, questionContext].join(' '));

    // Check for specific scope keywords
    for (const [scope, keywords] of Object.entries(SCOPE_HINTS)) {
        let hits = 0;
        for (const kw of keywords) {
            if (allText.includes(kw)) hits++;
        }
        if (hits >= 2) return scope;
    }

    // If the correction significantly changes content length, likely factual or service_info
    const lenRatio = (correctedReply || '').length / Math.max((originalReply || '').length, 1);
    if (lenRatio > 2.0) return 'factual'; // operator added a lot of content
    if (lenRatio < 0.3) return 'clarity'; // operator trimmed significantly

    // Default to tone if replies are similar in substance
    const sim = textSimilarity(originalReply || '', correctedReply || '');
    if (sim > 0.6) return 'tone';

    return 'factual'; // default
}

/**
 * Record an operator correction.
 *
 * @param {object} params
 * @param {string}   params.conversationId
 * @param {string}   params.originalAiReply   - what AI generated
 * @param {string}   params.correctedReply    - what operator sent
 * @param {string}   params.questionContext    - what the client asked
 * @param {string}   [params.correctionType]  - edit, rewrite, reject, operator_override
 * @param {string[]} [params.serviceTags]     - detected services
 * @returns {object} { saved, reason, scope, candidateCreated }
 */
export async function recordCorrection({
    conversationId,
    originalAiReply,
    correctedReply,
    questionContext,
    correctionType = 'edit',
    serviceTags = []
}) {
    // Guard: if no original AI reply, this is operator takeover, NOT a correction
    if (!originalAiReply || originalAiReply.trim().length === 0) {
        console.log('[Learning] Skipped: no original AI reply (operator takeover, not correction)');
        return { saved: false, reason: 'operator_takeover_not_correction' };
    }

    const similarity = textSimilarity(originalAiReply, correctedReply);

    // If >90% similar, not a meaningful correction
    if (similarity > 0.9) {
        console.log('[Learning] Skipped: correction too similar to original');
        return { saved: false, reason: 'too_similar' };
    }

    // Classify the correction scope
    const scope = classifyScope(originalAiReply, correctedReply, questionContext);
    console.log(`[Learning] Classified scope: ${scope}`);

    // Check for existing similar corrections to aggregate
    const { data: existing } = await supabase
        .from('ai_learned_corrections')
        .select('id, corrected_reply, times_seen, question_context, correction_scope, kb_candidate_status')
        .eq('promoted_to_kb', false)
        .limit(50);

    let matchedExisting = null;
    for (const ex of (existing || [])) {
        const replySim = textSimilarity(ex.corrected_reply, correctedReply);
        const questionSim = textSimilarity(ex.question_context || '', questionContext || '');
        if (replySim > 0.7 && questionSim > 0.5) {
            matchedExisting = ex;
            break;
        }
    }

    let candidateCreated = false;

    if (matchedExisting) {
        // Increment existing correction count
        const newCount = (matchedExisting.times_seen || 1) + 1;
        const updates = { times_seen: newCount };

        // Check if should become KB candidate
        if (newCount >= CANDIDATE_THRESHOLD &&
            matchedExisting.kb_candidate_status === 'none' &&
            KB_ELIGIBLE_SCOPES.includes(matchedExisting.correction_scope || scope)) {
            updates.kb_candidate_status = 'candidate';
            candidateCreated = true;
            console.log(`[Learning] Correction ${matchedExisting.id} → CANDIDATE (${newCount} times, scope=${scope})`);
        }

        await supabase.from('ai_learned_corrections')
            .update(updates)
            .eq('id', matchedExisting.id);

        console.log(`[Learning] Incremented correction ${matchedExisting.id} to ${newCount} times`);
        return { saved: true, reason: 'incremented', scope, times: newCount, candidateCreated };
    }

    // Save new correction
    const { error } = await supabase.from('ai_learned_corrections').insert({
        conversation_id: conversationId,
        original_ai_reply: originalAiReply,
        corrected_reply: correctedReply,
        question_context: questionContext,
        correction_type: correctionType,
        correction_scope: scope,
        service_tags: serviceTags,
        similarity_score: 1 - similarity,
        times_seen: 1,
        kb_candidate_status: 'none'
    });

    if (error) {
        console.error('[Learning] Save error:', error.message);
        return { saved: false, reason: 'db_error' };
    }

    console.log(`[Learning] New correction saved (scope=${scope}, diff=${(1 - similarity).toFixed(2)})`);
    return { saved: true, reason: 'new_correction', scope, times: 1, candidateCreated: false };
}

/**
 * Approve a KB candidate (manual/admin operation).
 * Creates a new KB entry from the correction.
 *
 * @param {string} correctionId - UUID of the ai_learned_corrections row
 * @param {object} kbOverrides  - optional overrides for the KB entry
 * @returns {object} { success, kbId }
 */
export async function approveCandidate(correctionId, kbOverrides = {}) {
    const { data: corr, error } = await supabase
        .from('ai_learned_corrections')
        .select('*')
        .eq('id', correctionId)
        .eq('kb_candidate_status', 'candidate')
        .single();

    if (error || !corr) {
        console.error('[Learning] Candidate not found:', correctionId);
        return { success: false, reason: 'not_found' };
    }

    const normQ = normalize(corr.question_context || '');
    const keywords = normQ.split(' ').filter(w => w.length > 3);

    const kbData = {
        knowledge_key: kbOverrides.knowledge_key || `learned_${Date.now()}`,
        category: kbOverrides.category || 'learned',
        service_tags: corr.service_tags || [],
        question_patterns: keywords.length > 0 ? keywords : [normQ],
        answer_template: corr.corrected_reply,
        metadata: { source_correction_id: correctionId },
        approval_status: 'approved',
        active: true,
        source: 'auto_promoted',
        verified_by: kbOverrides.verified_by || 'admin',
        ...kbOverrides
    };

    const { data: kbEntry, error: kbErr } = await supabase
        .from('ai_knowledge_base')
        .insert(kbData)
        .select('id')
        .single();

    if (kbErr) {
        console.error('[Learning] KB insert error:', kbErr.message);
        return { success: false, reason: 'kb_insert_error' };
    }

    await supabase.from('ai_learned_corrections')
        .update({
            kb_candidate_status: 'approved',
            promoted_to_kb: true,
            promoted_kb_id: kbEntry.id,
            reviewed_by: kbOverrides.verified_by || 'admin'
        })
        .eq('id', correctionId);

    console.log(`[Learning] Candidate ${correctionId} APPROVED → KB entry ${kbEntry.id}`);
    return { success: true, kbId: kbEntry.id };
}
