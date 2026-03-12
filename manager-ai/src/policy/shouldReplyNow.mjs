import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } from '../config/env.mjs';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ── Config ──
const COOLDOWN_SEC  = parseInt(process.env.AI_REPLY_COOLDOWN_SECONDS || '90', 10);
const DEBOUNCE_SEC  = parseInt(process.env.AI_REPLY_DEBOUNCE_SECONDS || '15', 10);
const DUP_THRESHOLD = 0.75;
const NO_INFO_THRESHOLD = 0.40;

// ── Conversation Lock (in-memory, per process) ──
const activeLocks = new Map();

export function acquireConversationLock(conversationId) {
    const existing = activeLocks.get(conversationId);
    if (existing && (Date.now() - existing) < 300_000) {
        console.log(`[ConvLock] Blocked: ${conversationId} locked for ${Math.round((Date.now() - existing)/1000)}s`);
        return false;
    }
    activeLocks.set(conversationId, Date.now());
    return true;
}

export function releaseConversationLock(conversationId) {
    activeLocks.delete(conversationId);
}

/**
 * Reply / Wait / Silence / Escalate Decision Engine
 *
 * Central decision point. Called BEFORE any send attempt.
 *
 * @param {object} params
 * @param {string} params.conversationId
 * @param {string} params.newReply           - reply about to be sent
 * @param {string} params.nextStep           - current next_step
 * @param {object} [params.mutation]         - mutation object
 * @param {string} [params.lastClientMessage]
 * @param {object} [params.escalation]       - escalation engine result
 * @param {object} [params.decision]         - LLM decision object
 * @param {object} [params.serviceConfidence]
 * @returns {Promise<object>}
 *   { decision, reason, details, turnState, significantUpdate, duplicateRisk, cooldownActive }
 */
export async function shouldReplyNow({
    conversationId,
    newReply,
    nextStep,
    mutation,
    lastClientMessage,
    escalation,
    decision: llmDecision,
    serviceConfidence
}) {
    const result = {
        decision: 'stay_silent',
        reason: 'not_evaluated',
        details: null,
        turnState: 'unknown',
        significantUpdate: false,
        duplicateRisk: false,
        cooldownActive: false,
        newInformationDetected: false
    };

    // ── 1. Master switch ──
    if (process.env.AI_AUTOREPLY_ENABLED !== 'true') {
        return { ...result, decision: 'stay_silent', reason: 'blocked_autoreply_off' };
    }

    try {
        // ── 2. Acknowledgment / empty message → stay_silent ──
        if (lastClientMessage && isAcknowledgment(lastClientMessage)) {
            console.log(`[ReplyEngine] Stay silent: acknowledgment message "${lastClientMessage.substring(0, 30)}"`);
            return { ...result, decision: 'stay_silent', reason: 'blocked_acknowledgment_only', turnState: 'client_ack', details: lastClientMessage.substring(0, 50) };
        }

        // ── 3. Escalation check ──
        if (escalation?.needs_escalation) {
            console.log(`[ReplyEngine] Escalate: ${escalation.escalation_type} — ${escalation.escalation_reason}`);
            return { ...result, decision: 'escalate', reason: `escalated_${escalation.escalation_type}`, details: escalation.escalation_reason, turnState: 'escalated' };
        }

        // Check for confused/angry client
        if (lastClientMessage && isConfusedOrAngry(lastClientMessage)) {
            console.log(`[ReplyEngine] Escalate: confused/angry client`);
            return { ...result, decision: 'escalate', reason: 'escalated_client_sentiment', details: 'Client appears confused or frustrated', turnState: 'escalated' };
        }

        // ── 4. Wait for more messages (burst detection) ──
        const burstState = await detectMessageBurst(conversationId);
        if (burstState.inBurst) {
            console.log(`[ReplyEngine] Wait: message burst detected (${burstState.recentCount} msgs in ${burstState.windowSec}s)`);
            return { ...result, decision: 'wait_for_more_messages', reason: 'blocked_debounce_window', turnState: 'client_burst', details: `${burstState.recentCount} messages in last ${burstState.windowSec}s` };
        }

        // ── 5. Fetch last AI reply for comparison ──
        const { data: lastSentRows } = await supabase
            .from('ai_reply_decisions')
            .select('suggested_reply, sent_at, created_at, next_step')
            .eq('conversation_id', conversationId)
            .eq('reply_status', 'sent')
            .eq('sent_by', 'ai')
            .order('created_at', { ascending: false })
            .limit(1);

        const lastSent = lastSentRows?.[0];

        // No previous AI reply → always reply
        if (!lastSent) {
            return { ...result, decision: 'reply_now', reason: 'allowed_first_reply', turnState: 'first_turn', newInformationDetected: true };
        }

        const lastSentAt = new Date(lastSent.sent_at || lastSent.created_at).getTime();
        const elapsedSec = Math.round((Date.now() - lastSentAt) / 1000);
        const lastReplyText = lastSent.suggested_reply || '';
        const similarity = textSimilarity(newReply, lastReplyText);

        result.duplicateRisk = similarity > DUP_THRESHOLD;
        result.cooldownActive = elapsedSec < COOLDOWN_SEC;

        // ── 6. Significant update override (checked BEFORE cooldown) ──
        const sigUpdate = checkSignificantUpdate(mutation, nextStep, lastSent.next_step, lastClientMessage);
        result.significantUpdate = sigUpdate.significant;
        result.newInformationDetected = sigUpdate.significant;

        if (sigUpdate.significant) {
            // Even if duplicate text, significant changes allow reply
            if (similarity < 0.95) {
                console.log(`[ReplyEngine] Reply now: significant update — ${sigUpdate.reason}`);
                return { ...result, decision: 'reply_now', reason: 'allowed_significant_update', details: sigUpdate.reason, turnState: 'significant_update' };
            }
        }

        // ── 7. Cooldown ──
        if (result.cooldownActive && !sigUpdate.significant) {
            console.log(`[ReplyEngine] Stay silent: cooldown (${elapsedSec}s < ${COOLDOWN_SEC}s)`);
            return { ...result, decision: 'stay_silent', reason: 'blocked_recent_ai_cooldown', details: `Last AI reply ${elapsedSec}s ago`, turnState: 'cooldown' };
        }

        // ── 8. Duplicate guard ──
        if (similarity > DUP_THRESHOLD) {
            console.log(`[ReplyEngine] Stay silent: duplicate (${(similarity * 100).toFixed(0)}%)`);
            return { ...result, decision: 'stay_silent', reason: 'blocked_duplicate_reply', details: `Similarity=${(similarity * 100).toFixed(0)}%`, turnState: 'duplicate', duplicateRisk: true };
        }

        // ── 9. No new info check ──
        if (lastSent.next_step && nextStep === lastSent.next_step && similarity > NO_INFO_THRESHOLD) {
            console.log(`[ReplyEngine] Stay silent: no new info (same step=${nextStep}, sim=${(similarity * 100).toFixed(0)}%)`);
            return { ...result, decision: 'stay_silent', reason: 'blocked_no_new_information', details: `Same next_step="${nextStep}", sim=${(similarity * 100).toFixed(0)}%`, turnState: 'no_new_info' };
        }

        // ── 10. All clear → reply ──
        console.log(`[ReplyEngine] Reply now: new turn (elapsed=${elapsedSec}s, sim=${(similarity * 100).toFixed(0)}%, nextStep=${nextStep})`);
        return { ...result, decision: 'reply_now', reason: 'allowed_new_turn', turnState: 'new_turn', newInformationDetected: true };

    } catch (err) {
        console.error('[ReplyEngine] Error — staying silent for safety:', err.message);
        return { ...result, decision: 'stay_silent', reason: 'blocked_engine_error', details: err.message };
    }
}

// ── Helpers ──

/** Detect if client is still in a message burst. */
async function detectMessageBurst(conversationId) {
    const windowMs = DEBOUNCE_SEC * 1000;
    const cutoff = new Date(Date.now() - windowMs).toISOString();

    const { data: recentMsgs } = await supabase
        .from('messages')
        .select('created_at')
        .eq('conversation_id', conversationId)
        .eq('sender_type', 'client')
        .gt('created_at', cutoff)
        .order('created_at', { ascending: false })
        .limit(10);

    const count = recentMsgs?.length || 0;
    // Burst = 3+ client messages in the debounce window
    return { inBurst: count >= 3, recentCount: count, windowSec: DEBOUNCE_SEC };
}

/** Detect acknowledgment-only messages. */
function isAcknowledgment(text) {
    const normalized = text.toLowerCase().trim().replace(/[!?.,,]+$/g, '').trim();
    const ACK_PATTERNS = [
        'ok', 'okay', 'bine', 'da', 'mhm', 'aha', 'in regula', 'înțeles',
        'am inteles', 'am înțeles', 'perfect', 'super', 'mersi', 'multumesc',
        'multumim', 'mulțumesc', 'mulțumim', 'ms', 'merci', 'k', 'good',
        'sigur', 'desigur', 'da da', 'okk', 'okei', 'oki', 'oky'
    ];
    // Must be short AND match a pattern
    return normalized.length <= 25 && ACK_PATTERNS.some(p => normalized === p || normalized.startsWith(p + ' '));
}

/** Detect confused/angry client messages. */
function isConfusedOrAngry(text) {
    const lower = text.toLowerCase();
    const ANGRY_PATTERNS = [
        'nu mai inteleg', 'nu mai înțeleg', 'ce se intampla', 'ce se întâmplă',
        'de ce ati schimbat', 'de ce ați schimbat', 'sunt nemultumit', 'sunt nemulțumit',
        'sunt suparat', 'sunt supărat', 'vreau sa vorbesc cu cineva', 'doresc sa vorbesc',
        'nu sunt multumit', 'nu sunt mulțumit', 'e o bataie de joc', 'o bătaie de joc',
        'sunt dezamagit', 'sunt dezamăgit', 'nu functioneaza', 'nu funcționează',
        'vreau reclamatie', 'vreau reclamație', 'anulati', 'anulați tot'
    ];
    return ANGRY_PATTERNS.some(p => lower.includes(p));
}

/** Check significant update. */
function checkSignificantUpdate(mutation, currentNextStep, lastNextStep, lastClientMessage) {
    if (mutation && mutation.mutation_type !== 'no_mutation' && mutation.mutation_confidence >= 70) {
        return { significant: true, reason: `mutation_${mutation.mutation_type}` };
    }
    if (lastNextStep && currentNextStep && lastNextStep !== currentNextStep) {
        const FORWARD = ['ask_event_date','ask_location','ask_time','ask_guest_count','ready_for_quote','confirm_changes'];
        if (FORWARD.includes(currentNextStep)) {
            return { significant: true, reason: `step_change: ${lastNextStep} → ${currentNextStep}` };
        }
    }
    if (lastClientMessage) {
        const msg = lastClientMessage.toLowerCase();
        if (/\d{1,2}\s*(ian|feb|mar|apr|mai|iun|iul|aug|sep|oct|nov|dec|ianuarie|februarie|martie|aprilie|iunie|iulie|august|septembrie|octombrie|noiembrie|decembrie)/i.test(msg)) {
            return { significant: true, reason: 'new_date_detected' };
        }
        if (/(nu mai|in loc|schimb|mut|anul|confirm|reactiv)/i.test(msg)) {
            return { significant: true, reason: 'mutation_keyword_detected' };
        }
    }
    return { significant: false, reason: null };
}

/** Bigram text similarity (Dice coefficient). */
function textSimilarity(a, b) {
    if (!a || !b) return 0;
    const norm = s => s.toLowerCase().replace(/[^\w\sîăâșț]/g, '').replace(/\s+/g, ' ').trim();
    const na = norm(a), nb = norm(b);
    if (na === nb) return 1;
    if (na.length < 2 || nb.length < 2) return 0;
    const bigrams = s => { const m = new Map(); for (let i = 0; i < s.length - 1; i++) { const bg = s.substring(i, i+2); m.set(bg, (m.get(bg)||0)+1); } return m; };
    const bg1 = bigrams(na), bg2 = bigrams(nb);
    let overlap = 0;
    for (const [bg, c] of bg1) { if (bg2.has(bg)) overlap += Math.min(c, bg2.get(bg)); }
    return (2 * overlap) / (na.length - 1 + nb.length - 1);
}
