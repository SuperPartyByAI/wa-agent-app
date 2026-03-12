#!/usr/bin/env node
/**
 * Revisit Worker — Deferred Follow-Up Processor
 *
 * Processes conversations with pending follow-ups whose follow_up_at has passed.
 *
 * Run modes:
 *   - Cron:  node revisitWorker.mjs --once
 *   - Loop:  node revisitWorker.mjs (polls every 60s)
 *   - PM2:   pm2 start revisitWorker.mjs --name revisit-worker
 *
 * Safety:
 *   - Worker lock prevents double-processing (idempotent)
 *   - Full re-evaluation before sending (7 checks)
 *   - Human takeover guard
 *   - Closing signal guard
 *   - Max 1 follow-up per conversation turn
 */

import dotenv from 'dotenv';
dotenv.config();

import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, WHTSUP_API_URL, WHTSUP_API_KEY } from '../config/env.mjs';
import { loadClientMemory } from '../memory/loadClientMemory.mjs';
import { detectClosingSignal } from '../policy/shouldReplyNow.mjs';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const WORKER_ID = `revisit-${process.pid}-${Date.now()}`;

/**
 * Process all due follow-ups.
 */
export async function processDueFollowUps() {
    const now = new Date().toISOString();

    const { data: dueItems, error } = await supabase
        .from('ai_deferred_followups')
        .select('*')
        .eq('status', 'pending')
        .lte('follow_up_at', now)
        .order('follow_up_at', { ascending: true })
        .limit(10);

    if (error) {
        console.error('[RevisitWorker] Query error:', error.message);
        return;
    }

    if (!dueItems || dueItems.length === 0) return;

    console.log(`[RevisitWorker] Found ${dueItems.length} due follow-up(s)`);

    for (const item of dueItems) {
        await processOneFollowUp(item);
    }
}

/**
 * Process a single follow-up with full 7-check re-evaluation.
 */
async function processOneFollowUp(item) {
    const { id, conversation_id, follow_up_reason, next_step_at_schedule, missing_fields } = item;
    const log = (msg) => console.log(`[RevisitWorker][${conversation_id.substring(0, 8)}] ${msg}`);

    // ── 1. Acquire worker lock (idempotency) ──
    const { data: lockData } = await supabase
        .from('ai_deferred_followups')
        .update({
            worker_lock_id: WORKER_ID,
            worker_lock_at: new Date().toISOString(),
            follow_up_attempted_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        })
        .eq('id', id)
        .eq('status', 'pending')
        .is('worker_lock_id', null)
        .select('id');

    if (!lockData || lockData.length === 0) {
        log('Already locked or processed. Skipping.');
        return;
    }

    try {
        // ── 2. Check: autoreply master switch ──
        if (process.env.AI_AUTOREPLY_ENABLED !== 'true') {
            await markSkipped(id, 'autoreply_off');
            log('Skipped: autoreply OFF.');
            return;
        }

        // ── 3. Check: has client sent new message since scheduling? ──
        const { data: newMsgs } = await supabase
            .from('messages')
            .select('id, created_at, content')
            .eq('conversation_id', conversation_id)
            .eq('sender_type', 'client')
            .gt('created_at', item.scheduled_at)
            .limit(1);

        if (newMsgs && newMsgs.length > 0) {
            await markSkipped(id, 'new_message');
            log('Skipped: client sent new message since scheduling.');
            return;
        }

        // ── 4. Check: has AI already replied since scheduling? ──
        const { data: aiReplies } = await supabase
            .from('ai_reply_decisions')
            .select('id, created_at')
            .eq('conversation_id', conversation_id)
            .eq('reply_status', 'sent')
            .eq('sent_by', 'ai')
            .gt('created_at', item.scheduled_at)
            .limit(1);

        if (aiReplies && aiReplies.length > 0) {
            await markSkipped(id, 'ai_already_replied');
            log('Skipped: AI already replied since scheduling.');
            return;
        }

        // ── 5. Check: HUMAN TAKEOVER — operator replied since scheduling? ──
        const { data: operatorMsgs } = await supabase
            .from('messages')
            .select('id, created_at')
            .eq('conversation_id', conversation_id)
            .eq('direction', 'outbound')
            .in('sender_type', ['agent', 'operator', 'human'])
            .gt('created_at', item.scheduled_at)
            .limit(1);

        if (operatorMsgs && operatorMsgs.length > 0) {
            await markSkipped(id, 'human_takeover');
            log('Skipped: operator replied (human takeover).');
            return;
        }

        // ── 6. Check: conversation state blocked? ──
        const { data: convState } = await supabase
            .from('ai_conversation_state')
            .select('current_stage')
            .eq('conversation_id', conversation_id)
            .maybeSingle();

        const stage = convState?.current_stage || 'lead';
        const BLOCKED_STAGES = ['closed', 'booked', 'blocked', 'escalated', 'archived', 'confirmed', 'completed'];
        if (BLOCKED_STAGES.includes(stage)) {
            await markSkipped(id, 'blocked_state');
            log(`Skipped: conversation is ${stage}.`);
            return;
        }

        // ── 7. Check: get last client message for closing signal check ──
        const { data: lastClientMsgs } = await supabase
            .from('messages')
            .select('content')
            .eq('conversation_id', conversation_id)
            .eq('sender_type', 'client')
            .order('created_at', { ascending: false })
            .limit(1);

        const lastClientText = lastClientMsgs?.[0]?.content || '';
        const closing = detectClosingSignal(lastClientText);
        if (closing.detected && !closing.hasOpenQuestion && !closing.hasActiveIntent) {
            await markSkipped(id, 'closing_signal');
            log('Skipped: closing signal detected at revisit.');
            return;
        }

        // ── 8. Build and send follow-up reply ──
        const { data: convData } = await supabase
            .from('conversations')
            .select('client_id')
            .eq('id', conversation_id)
            .maybeSingle();

        const entityMemory = convData?.client_id
            ? await loadClientMemory(convData.client_id)
            : {};

        const { data: existingDraft } = await supabase
            .from('ai_event_drafts')
            .select('services, event_date, location, guest_count')
            .eq('conversation_id', conversation_id)
            .maybeSingle();

        const followUpReply = buildFollowUpReply({
            followUpReason: follow_up_reason,
            missingFields: missing_fields || [],
            nextStep: next_step_at_schedule,
            existingDraft,
            entityMemory
        });

        const sent = await sendViaWhatsApp(conversation_id, followUpReply);

        if (sent) {
            await supabase.from('ai_deferred_followups').update({
                status: 'sent',
                follow_up_sent_at: new Date().toISOString(),
                follow_up_reply: followUpReply,
                updated_at: new Date().toISOString()
            }).eq('id', id);

            await supabase.from('ai_reply_decisions').insert({
                conversation_id,
                suggested_reply: followUpReply,
                can_auto_reply: true,
                needs_human_review: false,
                confidence_score: 80,
                conversation_stage: stage,
                reply_status: 'sent',
                sent_by: 'ai',
                sent_at: new Date().toISOString(),
                next_step: next_step_at_schedule || 'follow_up',
                progression_status: 'deferred_follow_up',
                escalation_reason: 'deferred_follow_up_triggered'
            });

            log(`Follow-up SENT: "${followUpReply.substring(0, 60)}..."`);
        } else {
            await markSkipped(id, 'send_failed');
            log('Follow-up send FAILED.');
        }

    } catch (err) {
        console.error(`[RevisitWorker][${conversation_id.substring(0, 8)}] Error:`, err.message);
        await markSkipped(id, 'worker_error');
    }
}

async function markSkipped(id, reason) {
    await supabase.from('ai_deferred_followups').update({
        status: 'skipped',
        skip_reason: reason,
        follow_up_attempted_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
    }).eq('id', id);
}

function buildFollowUpReply({ followUpReason, missingFields, nextStep, existingDraft }) {
    const openers = [
        'Buna! Am observat ca nu am reusit sa finalizam detaliile.',
        'Salut! Revin cu un mesaj scurt legat de cererea dumneavoastra.',
        'Buna ziua! Am vazut ca discutia noastra a ramas incompleta.'
    ];
    const opener = openers[Math.floor(Math.random() * openers.length)];

    if (missingFields.length > 0) {
        const fieldMap = {
            event_date: 'data evenimentului',
            location: 'locatia',
            guest_count: 'numarul de invitati',
            event_time: 'ora'
        };
        const missing = missingFields.map(f => fieldMap[f] || f).filter(Boolean).slice(0, 2);
        if (missing.length > 0) {
            return `${opener} Ne-ar ajuta sa stim ${missing.join(' si ')} pentru a va putea face o oferta. Va stam la dispozitie! 😊`;
        }
    }

    if (nextStep === 'ask_event_date') return `${opener} Pentru ce data aveti nevoie de serviciile noastre? 😊`;
    if (nextStep === 'ask_location') return `${opener} Unde va fi evenimentul? Ne-ar ajuta sa stim locatia. 😊`;

    return `${opener} Va putem ajuta cu mai multe detalii? Suntem la dispozitia dumneavoastra! 😊`;
}

async function sendViaWhatsApp(conversationId, text) {
    const { data: conv } = await supabase
        .from('conversations')
        .select('session_id')
        .eq('id', conversationId)
        .single();

    if (!conv?.session_id) {
        console.error('[RevisitWorker] No session_id for', conversationId);
        return false;
    }

    try {
        const response = await fetch(`${WHTSUP_API_URL}/api/messages/send`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-api-key': WHTSUP_API_KEY },
            body: JSON.stringify({ sessionId: conv.session_id, conversationId, text, message_type: 'text' })
        });
        if (!response.ok) {
            console.error('[RevisitWorker] API error:', await response.text());
            return false;
        }
        return true;
    } catch (err) {
        console.error('[RevisitWorker] Network error:', err.message);
        return false;
    }
}

// ── Runner ──
const isOnce = process.argv.includes('--once');
const POLL_INTERVAL = Number.parseInt(process.env.AI_REVISIT_POLL_SECONDS || '60', 10) * 1000;

async function run() {
    console.log(`[RevisitWorker] Starting (mode=${isOnce ? 'once' : 'loop'}, poll=${POLL_INTERVAL/1000}s, worker=${WORKER_ID})`);

    if (isOnce) {
        await processDueFollowUps();
        process.exit(0);
    }

    // eslint-disable-next-line no-constant-condition
    while (true) {
        try {
            await processDueFollowUps();
        } catch (err) {
            console.error('[RevisitWorker] Loop error:', err.message);
        }
        await new Promise(r => setTimeout(r, POLL_INTERVAL));
    }
}

const isMain = process.argv[1]?.endsWith('revisitWorker.mjs');
if (isMain) {
    run().catch(err => { console.error('[RevisitWorker] Fatal:', err); process.exit(1); });
}
