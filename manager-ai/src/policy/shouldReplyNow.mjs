import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } from '../config/env.mjs';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

/**
 * Should Reply Or Stay Silent Engine
 *
 * Central decision point for whether AI should send a reply.
 * Called BEFORE any send attempt (both fast path and full pipeline).
 *
 * 5 checks in order:
 *   1. Autoreply enabled check
 *   2. Cooldown: recent AI reply within cooldown window
 *   3. Duplicate: new reply too similar to last AI reply
 *   4. No-new-info: same next_step + no meaningful change
 *   5. Significant update override: if change is real, allow even during cooldown
 *
 * @param {object} params
 * @param {string} params.conversationId
 * @param {string} params.newReply         - the reply about to be sent
 * @param {string} params.nextStep         - current next_step from progression
 * @param {object} [params.mutation]       - mutation object (if any)
 * @param {string} [params.lastClientMessage] - latest client message text
 * @param {number} [params.cooldownSeconds=90] - cooldown window
 * @returns {Promise<object>} { decision, reason, details }
 *   decision: 'reply_now' | 'blocked_cooldown' | 'blocked_duplicate' | 'blocked_no_new_info' | 'blocked_autoreply_off'
 */
export async function shouldReplyNow({
    conversationId,
    newReply,
    nextStep,
    mutation,
    lastClientMessage,
    cooldownSeconds = 90
}) {
    const AUTOREPLY_ENABLED = process.env.AI_AUTOREPLY_ENABLED === 'true';

    // ── 1. Autoreply master switch ──
    if (!AUTOREPLY_ENABLED) {
        return { decision: 'blocked_autoreply_off', reason: 'AI_AUTOREPLY_ENABLED=false', details: null };
    }

    try {
        // Fetch last AI reply decision for this conversation
        const { data: lastDecisions } = await supabase
            .from('ai_reply_decisions')
            .select('suggested_reply, reply_status, sent_by, sent_at, created_at, next_step, conversation_stage')
            .eq('conversation_id', conversationId)
            .in('reply_status', ['sent'])
            .eq('sent_by', 'ai')
            .order('created_at', { ascending: false })
            .limit(1);

        const lastSent = lastDecisions?.[0];

        // No previous AI reply — always allow
        if (!lastSent) {
            return { decision: 'reply_now', reason: 'allowed_first_reply', details: null };
        }

        const lastSentAt = new Date(lastSent.sent_at || lastSent.created_at).getTime();
        const elapsedMs = Date.now() - lastSentAt;
        const elapsedSec = Math.round(elapsedMs / 1000);

        // ── 5. Significant update override (check BEFORE cooldown) ──
        const isSignificantUpdate = checkSignificantUpdate(mutation, nextStep, lastSent.next_step, lastClientMessage);
        if (isSignificantUpdate.significant) {
            console.log(`[ShouldReply] Significant update detected: ${isSignificantUpdate.reason}`);
            return { decision: 'reply_now', reason: 'allowed_significant_update', details: isSignificantUpdate.reason };
        }

        // ── 2. Cooldown check ──
        if (elapsedMs < cooldownSeconds * 1000) {
            console.log(`[ShouldReply] Blocked: cooldown (${elapsedSec}s < ${cooldownSeconds}s)`);
            return {
                decision: 'blocked_cooldown',
                reason: `blocked_recent_ai_cooldown`,
                details: `Last AI reply ${elapsedSec}s ago (cooldown=${cooldownSeconds}s)`
            };
        }

        // ── 3. Duplicate text check ──
        const lastReply = lastSent.suggested_reply || '';
        const similarity = textSimilarity(newReply, lastReply);

        if (similarity > 0.75) {
            console.log(`[ShouldReply] Blocked: duplicate reply (similarity=${(similarity * 100).toFixed(0)}%)`);
            return {
                decision: 'blocked_duplicate',
                reason: 'blocked_duplicate_reply',
                details: `Similarity=${(similarity * 100).toFixed(0)}% with last reply`
            };
        }

        // ── 4. No-new-info check ──
        if (lastSent.next_step && nextStep && lastSent.next_step === nextStep && similarity > 0.40) {
            console.log(`[ShouldReply] Blocked: no new info (same next_step=${nextStep}, similarity=${(similarity * 100).toFixed(0)}%)`);
            return {
                decision: 'blocked_no_new_info',
                reason: 'blocked_no_new_information',
                details: `Same next_step="${nextStep}" + similar reply (${(similarity * 100).toFixed(0)}%)`
            };
        }

        // All checks passed
        return { decision: 'reply_now', reason: 'allowed_new_turn', details: null };

    } catch (err) {
        console.error('[ShouldReply] Error — blocking as safety:', err.message);
        return { decision: 'blocked_cooldown', reason: 'blocked_guard_error', details: err.message };
    }
}

/**
 * Check if there's a significant update that warrants a new reply even during cooldown.
 */
function checkSignificantUpdate(mutation, currentNextStep, lastNextStep, lastClientMessage) {
    // Real mutation applied
    if (mutation && mutation.mutation_type !== 'no_mutation' && mutation.mutation_confidence >= 70) {
        return { significant: true, reason: `mutation_${mutation.mutation_type}` };
    }

    // Next step changed meaningfully
    if (lastNextStep && currentNextStep && lastNextStep !== currentNextStep) {
        // Only significant if we moved forward (not just noise)
        const FORWARD_STEPS = ['ask_event_date', 'ask_location', 'ask_time', 'ask_guest_count', 'ready_for_quote', 'confirm_changes'];
        if (FORWARD_STEPS.includes(currentNextStep)) {
            return { significant: true, reason: `next_step_changed: ${lastNextStep} → ${currentNextStep}` };
        }
    }

    // Client message contains clear new data (dates, locations, service keywords, etc.)
    if (lastClientMessage) {
        const msg = lastClientMessage.toLowerCase();
        const hasDate = /\d{1,2}\s*(ian|feb|mar|apr|mai|iun|iul|aug|sep|oct|nov|dec|ianuarie|februarie|martie|aprilie|iunie|iulie|august|septembrie|octombrie|noiembrie|decembrie)/i.test(msg);
        const hasMutation = /(nu mai|in loc|schimb|mut|anul|confirm|reactiv)/i.test(msg);
        if (hasDate || hasMutation) {
            return { significant: true, reason: hasDate ? 'new_date_detected' : 'mutation_keyword_detected' };
        }
    }

    return { significant: false, reason: null };
}

/**
 * Simple text similarity (bigram overlap / Dice coefficient).
 */
function textSimilarity(a, b) {
    if (!a || !b) return 0;
    const normalize = s => s.toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
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

// ── Conversation Lock (in-memory, per process) ──
const activeLocks = new Map(); // conversation_id → timestamp

/**
 * Try to acquire a conversation lock.
 * Returns true if lock acquired, false if conversation is already locked.
 */
export function acquireConversationLock(conversationId) {
    const existing = activeLocks.get(conversationId);
    if (existing) {
        const elapsedMs = Date.now() - existing;
        // Auto-expire after 5 minutes (safety net)
        if (elapsedMs < 300000) {
            console.log(`[ConvLock] Blocked: ${conversationId} already locked for ${Math.round(elapsedMs/1000)}s`);
            return false;
        }
        console.log(`[ConvLock] Lock expired for ${conversationId} (${Math.round(elapsedMs/1000)}s). Re-acquiring.`);
    }
    activeLocks.set(conversationId, Date.now());
    return true;
}

/**
 * Release a conversation lock.
 */
export function releaseConversationLock(conversationId) {
    activeLocks.delete(conversationId);
}
