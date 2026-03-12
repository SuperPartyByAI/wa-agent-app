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
 * 13 checks, 5 decisions:
 *  reply_now | wait_for_more_messages | wait_for_missing_info | stay_silent | escalate
 *
 * Signals returned:
 *  decision, reason, details, turnState, significantUpdate, duplicateRisk,
 *  cooldownActive, newInformationDetected, closingSignalDetected,
 *  customerPausedDetected, humanTakeoverActive, aiCommitmentPending
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
        newInformationDetected: false,
        closingSignalDetected: false,
        customerPausedDetected: false,
        humanTakeoverActive: false,
        aiCommitmentPending: false
    };

    // ── 1. Master switch ──
    if (process.env.AI_AUTOREPLY_ENABLED !== 'true') {
        return { ...result, decision: 'stay_silent', reason: 'blocked_autoreply_off' };
    }

    try {
        // ── 2. HUMAN TAKEOVER GUARD ──
        const takeover = await detectHumanTakeover(conversationId);
        result.humanTakeoverActive = takeover.active;
        if (takeover.active) {
            console.log(`[ReplyEngine] Stay silent: human takeover (operator replied ${takeover.elapsedSec}s ago)`);
            return { ...result, decision: 'stay_silent', reason: 'blocked_human_takeover', turnState: 'human_takeover', details: `Operator replied ${takeover.elapsedSec}s ago` };
        }

        // ── 3. Acknowledgment → stay_silent ──
        if (lastClientMessage && isAcknowledgment(lastClientMessage)) {
            console.log(`[ReplyEngine] Stay silent: acknowledgment "${lastClientMessage.substring(0, 30)}"`);
            return { ...result, decision: 'stay_silent', reason: 'blocked_acknowledgment_only', turnState: 'client_ack' };
        }

        // ── 4. Customer paused → stay_silent, no follow-up ──
        if (lastClientMessage && isCustomerPaused(lastClientMessage)) {
            console.log(`[ReplyEngine] Stay silent: customer paused "${lastClientMessage.substring(0, 30)}"`);
            result.customerPausedDetected = true;
            return { ...result, decision: 'stay_silent', reason: 'blocked_customer_paused', turnState: 'customer_paused' };
        }

        // ── 5. Closing signal guard ──
        if (lastClientMessage) {
            const closing = detectClosingSignal(lastClientMessage);
            result.closingSignalDetected = closing.detected;
            if (closing.detected && !closing.hasOpenQuestion && !closing.hasActiveIntent) {
                console.log(`[ReplyEngine] Stay silent: closing signal (pure close, no open question)`);
                return { ...result, decision: 'stay_silent', reason: 'blocked_closing_signal', turnState: 'soft_closed_turn', details: closing.signal };
            }
            // If closing + open question → closing is neutralized, continue evaluation
            if (closing.detected && (closing.hasOpenQuestion || closing.hasActiveIntent)) {
                console.log(`[ReplyEngine] Closing signal neutralized: coexists with open question/intent`);
                result.closingSignalDetected = false; // neutralized
            }
        }

        // ── 6. Escalation check ──
        if (escalation?.needs_escalation) {
            console.log(`[ReplyEngine] Escalate: ${escalation.escalation_type} — ${escalation.escalation_reason}`);
            return { ...result, decision: 'escalate', reason: `escalated_${escalation.escalation_type}`, details: escalation.escalation_reason, turnState: 'escalated' };
        }

        if (lastClientMessage && isConfusedOrAngry(lastClientMessage)) {
            console.log(`[ReplyEngine] Escalate: confused/angry client`);
            return { ...result, decision: 'escalate', reason: 'escalated_client_sentiment', turnState: 'escalated' };
        }

        // ── 7. Burst detection → wait_for_more_messages ──
        const burstState = await detectMessageBurst(conversationId);
        if (burstState.inBurst) {
            console.log(`[ReplyEngine] Wait: message burst (${burstState.recentCount} msgs in ${burstState.windowSec}s)`);
            return { ...result, decision: 'wait_for_more_messages', reason: 'blocked_debounce_window', turnState: 'client_burst', details: `${burstState.recentCount} messages in last ${burstState.windowSec}s` };
        }

        // ── 8. Wait for missing info (intent but incomplete data) ──
        if (lastClientMessage) {
            const hasIntent = /animator|popcorn|vata|ursitoare|petrecere|eveniment|nunta|botez|serbare|arcada|baloane|cifre|mos|gheata|parfumerie/i.test(lastClientMessage);
            if (hasIntent) {
                const msg = lastClientMessage.toLowerCase();
                const hasDate = /\d{1,2}\s*(ian|feb|mar|apr|mai|iun|iul|aug|sep|oct|nov|dec)/i.test(msg) || /\d{1,2}[./-]\d{1,2}/i.test(msg);
                const hasLocation = /bucuresti|sector|strada|adresa|locatie|oras|comuna/i.test(msg);
                const hasTime = /ora\s*\d|\d{1,2}:\d{2}/i.test(msg);
                const hasGuests = /\d+\s*(copii|persoane|invitati)/i.test(msg);
                const missingCount = [hasDate, hasLocation, hasTime, hasGuests].filter(x => !x).length;

                // Only wait_for_missing_info if 3+ fields missing AND it's a short/simple request
                // If message is detailed enough, reply_now with clarifying question is better
                if (missingCount >= 3 && lastClientMessage.length < 80) {
                    console.log(`[ReplyEngine] Wait for missing info: ${missingCount} fields missing, short message`);
                    return { ...result, decision: 'wait_for_missing_info', reason: 'incomplete_client_data', turnState: 'missing_info', details: `${missingCount} fields missing`, newInformationDetected: true };
                }
            }
        }

        // ── 9. Fetch last AI reply for comparison ──
        const { data: lastSentRows } = await supabase
            .from('ai_reply_decisions')
            .select('suggested_reply, sent_at, created_at, next_step')
            .eq('conversation_id', conversationId)
            .eq('reply_status', 'sent')
            .eq('sent_by', 'ai')
            .order('created_at', { ascending: false })
            .limit(1);

        const lastSent = lastSentRows?.[0];

        if (!lastSent) {
            return { ...result, decision: 'reply_now', reason: 'allowed_first_reply', turnState: 'first_turn', newInformationDetected: true };
        }

        const lastSentAt = new Date(lastSent.sent_at || lastSent.created_at).getTime();
        const elapsedSec = Math.round((Date.now() - lastSentAt) / 1000);
        const lastReplyText = lastSent.suggested_reply || '';
        const similarity = textSimilarity(newReply, lastReplyText);

        result.duplicateRisk = similarity > DUP_THRESHOLD;
        result.cooldownActive = elapsedSec < COOLDOWN_SEC;

        // ── 10. AI commitment pending check ──
        result.aiCommitmentPending = detectAiCommitmentPending(lastReplyText);

        // ── 11. Significant update override ──
        const sigUpdate = checkSignificantUpdate(mutation, nextStep, lastSent.next_step, lastClientMessage);
        result.significantUpdate = sigUpdate.significant;
        result.newInformationDetected = sigUpdate.significant;

        if (sigUpdate.significant && similarity < 0.95) {
            console.log(`[ReplyEngine] Reply now: significant update — ${sigUpdate.reason}`);
            return { ...result, decision: 'reply_now', reason: 'allowed_significant_update', details: sigUpdate.reason, turnState: 'significant_update' };
        }

        // ── 12. Cooldown ──
        if (result.cooldownActive && !sigUpdate.significant) {
            console.log(`[ReplyEngine] Stay silent: cooldown (${elapsedSec}s < ${COOLDOWN_SEC}s)`);
            return { ...result, decision: 'stay_silent', reason: 'blocked_recent_ai_cooldown', details: `Last AI reply ${elapsedSec}s ago`, turnState: 'cooldown' };
        }

        // ── 13. Duplicate guard ──
        if (similarity > DUP_THRESHOLD) {
            console.log(`[ReplyEngine] Stay silent: duplicate (${(similarity * 100).toFixed(0)}%)`);
            return { ...result, decision: 'stay_silent', reason: 'blocked_duplicate_reply', turnState: 'duplicate', duplicateRisk: true };
        }

        // ── 14. No new info ──
        if (lastSent.next_step && nextStep === lastSent.next_step && similarity > NO_INFO_THRESHOLD) {
            console.log(`[ReplyEngine] Stay silent: no new info (step=${nextStep}, sim=${(similarity * 100).toFixed(0)}%)`);
            return { ...result, decision: 'stay_silent', reason: 'blocked_no_new_information', turnState: 'no_new_info' };
        }

        // ── 15. All clear → reply ──
        console.log(`[ReplyEngine] Reply now: new turn (elapsed=${elapsedSec}s, sim=${(similarity * 100).toFixed(0)}%, nextStep=${nextStep})`);
        return { ...result, decision: 'reply_now', reason: 'allowed_new_turn', turnState: 'new_turn', newInformationDetected: true };

    } catch (err) {
        console.error('[ReplyEngine] Error — staying silent for safety:', err.message);
        return { ...result, decision: 'stay_silent', reason: 'blocked_engine_error', details: err.message };
    }
}

// ════════════════════════════════════════
// GUARDS & DETECTORS
// ════════════════════════════════════════

/** Human Takeover Guard: detect if operator replied recently. */
async function detectHumanTakeover(conversationId) {
    const { data: operatorMsgs } = await supabase
        .from('messages')
        .select('created_at, sender_type')
        .eq('conversation_id', conversationId)
        .eq('direction', 'outbound')
        .in('sender_type', ['agent', 'operator', 'human'])
        .order('created_at', { ascending: false })
        .limit(1);

    if (!operatorMsgs || operatorMsgs.length === 0) {
        return { active: false, elapsedSec: null };
    }

    const lastOpAt = new Date(operatorMsgs[0].created_at).getTime();

    // Check if last outbound was from operator (not AI)
    const { data: lastAiSent } = await supabase
        .from('ai_reply_decisions')
        .select('sent_at, created_at')
        .eq('conversation_id', conversationId)
        .eq('reply_status', 'sent')
        .eq('sent_by', 'ai')
        .order('created_at', { ascending: false })
        .limit(1);

    const lastAiAt = lastAiSent?.[0]
        ? new Date(lastAiSent[0].sent_at || lastAiSent[0].created_at).getTime()
        : 0;

    // Operator replied MORE RECENTLY than AI → human takeover active
    if (lastOpAt > lastAiAt) {
        const elapsedSec = Math.round((Date.now() - lastOpAt) / 1000);
        return { active: true, elapsedSec, lastOperatorReplyAt: operatorMsgs[0].created_at };
    }

    // Check if last inbound from client came AFTER the operator reply
    // If yes, it's a new turn — takeover may be released
    const { data: lastClientMsg } = await supabase
        .from('messages')
        .select('created_at')
        .eq('conversation_id', conversationId)
        .eq('sender_type', 'client')
        .eq('direction', 'inbound')
        .order('created_at', { ascending: false })
        .limit(1);

    if (lastClientMsg?.[0]) {
        const clientAt = new Date(lastClientMsg[0].created_at).getTime();
        // Client wrote AFTER operator but AFTER AI → new turn, takeover released
        if (clientAt > lastOpAt && clientAt > lastAiAt) {
            return { active: false, elapsedSec: null, released: true };
        }
    }

    return { active: false, elapsedSec: null };
}

/** Detect closing signal in message. */
export function detectClosingSignal(text) {
    const lower = text.toLowerCase().trim();
    const CLOSING_PATTERNS = [
        /^o zi (buna|frumoasa|minunata)/i,
        /va (doresc|dorim) o zi/i,
        /multumesc.*o zi/i, /mersi.*o zi/i,
        /^(mersi mult|multumesc mult|multumim mult)$/i,
        /^vorbim$/i, /^ramane asa$/i, /^rămâne așa$/i,
        /^bine.*merc/i, /^bine.*mult/i,
        /^(ms|merci|mersi)$/i,
        /^pa$/i, /^la revedere$/i, /^noapte buna$/i
    ];
    const detected = CLOSING_PATTERNS.some(p => p.test(lower));

    // Check if closing coexists with open question or active intent
    const hasOpenQuestion = /\?/.test(text) ||
        /cat costa|cât costă|aveti|aveți|se poate|puteti|puteți/i.test(text);
    const hasActiveIntent = /vreau|doresc|as vrea|aș vrea|ma intereseaza|mă interesează|animator|popcorn|petrecere|eveniment/i.test(text);

    return {
        detected,
        signal: detected ? lower.substring(0, 40) : null,
        hasOpenQuestion,
        hasActiveIntent,
        neutralized: detected && (hasOpenQuestion || hasActiveIntent)
    };
}

/** Detect customer-paused signals. */
function isCustomerPaused(text) {
    const lower = text.toLowerCase().trim().replace(/[!?.]+$/g, '').trim();
    const PAUSE_PATTERNS = [
        /^revin eu$/i, /^revin$/i,
        /^ma mai gandesc$/i, /^mă mai gândesc$/i,
        /^ok.*revin$/i, /^bine.*revin$/i,
        /^te anunt eu$/i, /^te anunț eu$/i,
        /^lasa ca revin$/i, /^lasă că revin$/i,
        /^stiu eu$/i, /^știu eu$/i,
        /^va anunt$/i, /^vă anunț$/i,
        /^mai vorbim$/i
    ];
    return lower.length <= 35 && PAUSE_PATTERNS.some(p => p.test(lower));
}

/** Detect AI commitment pending in last AI reply. */
function detectAiCommitmentPending(lastAiReply) {
    if (!lastAiReply) return false;
    const lower = lastAiReply.toLowerCase();
    return /revin (cu|imediat|in scurt)|verific.*(si|și) (revin|va anunt)|va (trimit|anunt|contactez)|o sa.*verific/i.test(lower);
}

/** Detect acknowledgment-only messages. */
function isAcknowledgment(text) {
    const normalized = text.toLowerCase().trim().replace(/[!?.,,]+$/g, '').trim();
    const ACK_PATTERNS = [
        'ok', 'okay', 'bine', 'da', 'mhm', 'aha', 'in regula',
        'am inteles', 'perfect', 'super', 'mersi', 'multumesc',
        'ms', 'merci', 'k', 'good', 'sigur', 'desigur', 'da da', 'okk', 'okei', 'oki'
    ];
    return normalized.length <= 25 && ACK_PATTERNS.some(p => normalized === p || normalized.startsWith(p + ' '));
}

/** Detect confused/angry client messages. */
function isConfusedOrAngry(text) {
    const lower = text.toLowerCase();
    const ANGRY_PATTERNS = [
        'nu mai inteleg', 'ce se intampla', 'de ce ati schimbat',
        'sunt nemultumit', 'sunt suparat', 'vreau sa vorbesc cu cineva',
        'nu sunt multumit', 'e o bataie de joc', 'vreau reclamatie', 'anulati tot'
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
        if (/\d{1,2}\s*(ian|feb|mar|apr|mai|iun|iul|aug|sep|oct|nov|dec)/i.test(msg)) {
            return { significant: true, reason: 'new_date_detected' };
        }
        if (/(nu mai|in loc|schimb|mut|anul|confirm|reactiv)/i.test(msg)) {
            return { significant: true, reason: 'mutation_keyword_detected' };
        }
    }
    return { significant: false, reason: null };
}

/** Burst detection. */
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
    return { inBurst: count >= 3, recentCount: count, windowSec: DEBOUNCE_SEC };
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
