import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } from '../config/env.mjs';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

/**
 * Spam Guard — prevents duplicate/spam AI replies.
 *
 * Checks:
 *   1. Cooldown: was an AI reply sent in this conversation recently?
 *   2. Duplicate: is the new reply >80% similar to the last AI reply?
 *   3. No new info: has next_step or draft changed since last reply?
 *
 * @param {object} params
 * @param {string} params.conversationId
 * @param {string} params.newReply         - the reply about to be sent
 * @param {string} params.nextStep         - current next_step from progression
 * @param {number} params.draftVersion     - current draft version
 * @param {number} [params.cooldownMs=60000] - cooldown window in ms
 * @returns {Promise<object>} { allow_send, block_reason, details }
 */
export async function evaluateSpamGuard({
    conversationId,
    newReply,
    nextStep,
    draftVersion,
    cooldownMs = 60000
}) {
    try {
        // Fetch last AI reply decision for this conversation
        const { data: lastDecisions } = await supabase
            .from('ai_reply_decisions')
            .select('suggested_reply, reply_status, sent_by, sent_at, created_at, next_step')
            .eq('conversation_id', conversationId)
            .eq('reply_status', 'sent')
            .eq('sent_by', 'ai')
            .order('created_at', { ascending: false })
            .limit(1);

        const lastSent = lastDecisions?.[0];

        if (!lastSent) {
            // No previous AI reply — allow
            return { allow_send: true, block_reason: 'allowed_first_reply', details: null };
        }

        // ── 1. Cooldown check ──
        const lastSentAt = new Date(lastSent.sent_at || lastSent.created_at).getTime();
        const elapsed = Date.now() - lastSentAt;

        if (elapsed < cooldownMs) {
            const remainingSec = Math.round((cooldownMs - elapsed) / 1000);
            console.log(`[SpamGuard] Blocked: cooldown (${remainingSec}s remaining)`);
            return {
                allow_send: false,
                block_reason: 'blocked_cooldown',
                details: `Last AI reply ${Math.round(elapsed / 1000)}s ago (cooldown=${cooldownMs / 1000}s)`
            };
        }

        // ── 2. Duplicate text check ──
        const lastReply = lastSent.suggested_reply || '';
        const similarity = textSimilarity(newReply, lastReply);

        if (similarity > 0.80) {
            console.log(`[SpamGuard] Blocked: duplicate reply (similarity=${(similarity * 100).toFixed(0)}%)`);
            return {
                allow_send: false,
                block_reason: 'blocked_duplicate_reply',
                details: `Similarity=${(similarity * 100).toFixed(0)}% with last reply`
            };
        }

        // ── 3. No-new-info check ──
        // If next_step hasn't changed and we're asking the same question again
        if (lastSent.next_step && nextStep && lastSent.next_step === nextStep && similarity > 0.50) {
            console.log(`[SpamGuard] Blocked: no new info (same next_step=${nextStep}, similarity=${(similarity * 100).toFixed(0)}%)`);
            return {
                allow_send: false,
                block_reason: 'blocked_no_new_information',
                details: `Same next_step="${nextStep}" + similar reply (${(similarity * 100).toFixed(0)}%)`
            };
        }

        // All checks passed
        return { allow_send: true, block_reason: 'allowed_new_turn', details: null };

    } catch (err) {
        console.error('[SpamGuard] Error, allowing send as fallback:', err.message);
        return { allow_send: true, block_reason: 'allowed_guard_error', details: err.message };
    }
}

/**
 * Simple text similarity (bigram overlap / Dice coefficient).
 * Fast, no external deps.
 */
function textSimilarity(a, b) {
    if (!a || !b) return 0;
    const normalize = s => s.toLowerCase().replace(/[^\w\s]/g, '').trim();
    const na = normalize(a);
    const nb = normalize(b);
    if (na === nb) return 1;
    if (na.length < 2 || nb.length < 2) return 0;

    const bigrams = s => {
        const set = new Map();
        for (let i = 0; i < s.length - 1; i++) {
            const bg = s.substring(i, i + 2);
            set.set(bg, (set.get(bg) || 0) + 1);
        }
        return set;
    };

    const bg1 = bigrams(na);
    const bg2 = bigrams(nb);
    let overlap = 0;

    for (const [bg, count] of bg1) {
        if (bg2.has(bg)) overlap += Math.min(count, bg2.get(bg));
    }

    return (2 * overlap) / (na.length - 1 + nb.length - 1);
}
