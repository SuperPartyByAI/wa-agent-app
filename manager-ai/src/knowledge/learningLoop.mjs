/**
 * Learning Loop — Capture operator corrections for KB promotion
 *
 * When an operator edits or replaces an AI reply, the correction
 * is saved. After 3+ similar corrections, the answer is promoted
 * to the Knowledge Base.
 *
 * Safety:
 *  - Only learns from HUMAN corrections, never from AI output
 *  - Requires 3+ occurrences before KB promotion
 *  - Operator can reject/deactivate any KB entry
 */

import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } from '../config/env.mjs';
import { invalidateKBCache } from './knowledgeBase.mjs';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const PROMOTION_THRESHOLD = 3; // corrections needed before KB promotion

/**
 * Normalize text for comparison
 */
function normalize(text) {
    return (text || '')
        .toLowerCase()
        .replace(/[ăâ]/g, 'a').replace(/[îi]/g, 'i')
        .replace(/[șş]/g, 's').replace(/[țţ]/g, 't')
        .replace(/[^a-z0-9\s]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Calculate similarity between two texts (0-1, Jaccard on words)
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
 * Record an operator correction.
 *
 * @param {object} params
 * @param {string} params.conversationId
 * @param {string} params.originalAiReply - what AI generated
 * @param {string} params.correctedReply - what operator sent
 * @param {string} params.questionContext - what the client asked
 * @param {string} [params.correctionType] - edit, rewrite, reject
 */
export async function recordCorrection({
    conversationId,
    originalAiReply,
    correctedReply,
    questionContext,
    correctionType = 'edit'
}) {
    const similarity = textSimilarity(originalAiReply, correctedReply);

    // If >90% similar, not a real correction
    if (similarity > 0.9) {
        console.log('[Learning] Skipped: correction too similar to original');
        return { saved: false, reason: 'too_similar' };
    }

    // Check for existing similar corrections
    const { data: existing } = await supabase
        .from('ai_learned_corrections')
        .select('id, corrected_reply, times_seen, question_context')
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

    if (matchedExisting) {
        // Increment existing correction
        const newCount = (matchedExisting.times_seen || 1) + 1;
        await supabase.from('ai_learned_corrections')
            .update({ times_seen: newCount })
            .eq('id', matchedExisting.id);

        console.log(`[Learning] Incremented correction ${matchedExisting.id} to ${newCount} times`);

        // Auto-promote to KB if threshold reached
        if (newCount >= PROMOTION_THRESHOLD) {
            await promoteToKB(matchedExisting.id, correctedReply, questionContext);
        }

        return { saved: true, reason: 'incremented', times: newCount };
    }

    // Save new correction
    const { error } = await supabase.from('ai_learned_corrections').insert({
        conversation_id: conversationId,
        original_ai_reply: originalAiReply,
        corrected_reply: correctedReply,
        question_context: questionContext,
        correction_type: correctionType,
        similarity_score: 1 - similarity,
        times_seen: 1
    });

    if (error) {
        console.error('[Learning] Save error:', error.message);
        return { saved: false, reason: 'db_error' };
    }

    console.log(`[Learning] New correction saved (similarity_diff=${(1 - similarity).toFixed(2)})`);
    return { saved: true, reason: 'new_correction', times: 1 };
}

/**
 * Promote a correction to the Knowledge Base after reaching threshold.
 */
async function promoteToKB(correctionId, answer, questionContext) {
    const normQuestion = normalize(questionContext);
    const keywords = normQuestion.split(' ').filter(w => w.length > 3);
    const patterns = keywords.length > 0 ? keywords : [normQuestion];

    const { data: kbEntry, error } = await supabase
        .from('ai_knowledge_base')
        .insert({
            category: 'learned',
            question_patterns: patterns,
            answer,
            verified_by: 'auto_promoted',
            metadata: { source_correction_id: correctionId, promoted_at: new Date().toISOString() }
        })
        .select('id')
        .single();

    if (error) {
        console.error('[Learning] KB promotion error:', error.message);
        return;
    }

    await supabase.from('ai_learned_corrections')
        .update({ promoted_to_kb: true, promoted_kb_id: kbEntry.id })
        .eq('id', correctionId);

    invalidateKBCache();
    console.log(`[Learning] Correction ${correctionId} promoted to KB as ${kbEntry.id}`);
}
