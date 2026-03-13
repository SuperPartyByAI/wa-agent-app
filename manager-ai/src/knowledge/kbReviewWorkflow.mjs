/**
 * KB Review Workflow — list / approve / reject / edit candidates
 *
 * Provides controlled KB candidate lifecycle:
 *  - listCandidates()
 *  - approveCandidate(id, opts)  → creates KB entry, marks reviewed
 *  - rejectCandidate(id, opts)   → marks rejected, no KB change
 *
 * Safety:
 *  - No auto-activation of KB entries
 *  - No hard delete
 *  - Idempotent operations
 *  - Full audit trail (reviewed_by, reviewed_at, review_notes)
 */

import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } from '../config/env.mjs';
import { invalidateKBCache } from './knowledgeMatcher.mjs';
import { normalize } from './knowledgeMatcher.mjs';
import { recordEvent } from '../analytics/recordAiEvent.mjs';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

/**
 * List all KB candidates (pending review).
 */
export async function listCandidates(opts = {}) {
    const limit = opts.limit || 50;
    const { data, error } = await supabase
        .from('ai_learned_corrections')
        .select('id, corrected_reply, question_context, correction_scope, correction_type, service_tags, times_seen, kb_candidate_status, created_at, original_ai_reply')
        .eq('kb_candidate_status', 'candidate')
        .order('times_seen', { ascending: false })
        .limit(limit);

    if (error) return { success: false, error: error.message };
    return { success: true, candidates: data || [], count: data?.length || 0 };
}

/**
 * Approve a KB candidate → create KB entry.
 *
 * @param {string} candidateId — UUID
 * @param {object} opts
 * @param {string} opts.reviewedBy — who approved
 * @param {string} [opts.reviewNotes]
 * @param {string} [opts.knowledgeKey] — override knowledge_key
 * @param {string} [opts.category] — override category
 * @param {string} [opts.editedAnswer] — optional edit before publish
 * @param {string[]} [opts.questionPatterns] — override patterns
 */
export async function approveCandidate(candidateId, opts = {}) {
    const reviewedBy = opts.reviewedBy || 'admin';

    // Fetch candidate
    const { data: corr, error: fetchErr } = await supabase
        .from('ai_learned_corrections')
        .select('*')
        .eq('id', candidateId)
        .single();

    if (fetchErr || !corr) {
        return { success: false, reason: 'candidate_not_found' };
    }

    // Idempotent: already approved
    if (corr.kb_candidate_status === 'approved') {
        return { success: true, reason: 'already_approved', kbId: corr.promoted_kb_id };
    }

    // Reject if not in candidate status
    if (corr.kb_candidate_status !== 'candidate') {
        return { success: false, reason: `invalid_status_${corr.kb_candidate_status}` };
    }

    // Build KB entry
    const answer = opts.editedAnswer || corr.corrected_reply;
    const normQ = normalize(corr.question_context || '');
    const defaultPatterns = normQ.split(' ').filter(w => w.length > 3);

    const knowledgeKey = opts.knowledgeKey || `learned_${candidateId.substring(0, 8)}`;
    const category = opts.category || (corr.correction_scope === 'pricing' ? 'pricing' : 'learned');

    const kbPayload = {
        knowledge_key: knowledgeKey,
        category,
        service_tags: corr.service_tags || [],
        question_patterns: opts.questionPatterns || (defaultPatterns.length > 0 ? defaultPatterns : [normQ]),
        answer_template: answer,
        metadata: { source_correction_id: candidateId, times_seen: corr.times_seen },
        approval_status: 'approved',
        active: true,
        source: 'auto_promoted',
        verified_by: reviewedBy
    };

    // Insert KB entry
    const { data: kbEntry, error: kbErr } = await supabase
        .from('ai_knowledge_base')
        .insert(kbPayload)
        .select('id')
        .single();

    if (kbErr) {
        // Duplicate key? Try a variant
        if (kbErr.message.includes('duplicate')) {
            kbPayload.knowledge_key = `${knowledgeKey}_${Date.now()}`;
            const { data: kbRetry, error: retryErr } = await supabase
                .from('ai_knowledge_base')
                .insert(kbPayload)
                .select('id')
                .single();
            if (retryErr) return { success: false, reason: 'kb_insert_error', detail: retryErr.message };
            kbEntry = kbRetry;
        } else {
            return { success: false, reason: 'kb_insert_error', detail: kbErr.message };
        }
    }

    // Mark correction as approved
    await supabase.from('ai_learned_corrections')
        .update({
            kb_candidate_status: 'approved',
            promoted_to_kb: true,
            promoted_kb_id: kbEntry.id,
            reviewed_by: reviewedBy,
            reviewed_at: new Date().toISOString(),
            review_notes: opts.reviewNotes || null
        })
        .eq('id', candidateId);

    invalidateKBCache();
    recordEvent('learned_correction_candidate_approved', corr.conversation_id, {
        candidateId, kbId: kbEntry.id, reviewedBy
    });

    console.log(`[KBReview] Approved candidate ${candidateId} → KB entry ${kbEntry.id}`);
    return { success: true, reason: 'approved', kbId: kbEntry.id, knowledgeKey: kbPayload.knowledge_key };
}

/**
 * Reject a KB candidate.
 *
 * @param {string} candidateId
 * @param {object} opts
 * @param {string} opts.reviewedBy
 * @param {string} [opts.rejectionReason]
 * @param {string} [opts.reviewNotes]
 */
export async function rejectCandidate(candidateId, opts = {}) {
    const reviewedBy = opts.reviewedBy || 'admin';

    const { data: corr, error } = await supabase
        .from('ai_learned_corrections')
        .select('id, kb_candidate_status, conversation_id')
        .eq('id', candidateId)
        .single();

    if (error || !corr) {
        return { success: false, reason: 'candidate_not_found' };
    }

    // Idempotent
    if (corr.kb_candidate_status === 'rejected') {
        return { success: true, reason: 'already_rejected' };
    }

    await supabase.from('ai_learned_corrections')
        .update({
            kb_candidate_status: 'rejected',
            reviewed_by: reviewedBy,
            reviewed_at: new Date().toISOString(),
            review_notes: opts.reviewNotes || opts.rejectionReason || null
        })
        .eq('id', candidateId);

    recordEvent('learned_correction_candidate_rejected', corr.conversation_id, {
        candidateId, reviewedBy, reason: opts.rejectionReason
    });

    console.log(`[KBReview] Rejected candidate ${candidateId}`);
    return { success: true, reason: 'rejected' };
}
