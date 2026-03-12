#!/usr/bin/env node
/**
 * Catch-Up Scanner — Unanswered Message Recovery
 *
 * Scans for conversations where:
 *  - Client sent a message
 *  - AI never responded (no sent reply after that message)
 *  - Message is NOT a closing signal / ack / customer paused
 *
 * Triggers the pipeline for each unanswered conversation.
 *
 * Run modes:
 *   - Cron:  node catchupScanner.mjs --once
 *   - Loop:  node catchupScanner.mjs (polls every 2 min)
 *   - PM2:   pm2 start catchupScanner.mjs --name catchup-scanner
 */

import dotenv from 'dotenv';
dotenv.config();

import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } from '../config/env.mjs';
import { detectClosingSignal } from '../policy/shouldReplyNow.mjs';
import { processConversation } from './processConversation.mjs';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const LOOKBACK_MS = Number.parseInt(process.env.AI_CATCHUP_LOOKBACK_MINUTES || '60', 10) * 60 * 1000;
const POLL_INTERVAL = Number.parseInt(process.env.AI_CATCHUP_POLL_SECONDS || '120', 10) * 1000;
const MIN_AGE_MS = 60_000; // Don't catch up messages less than 1 min old (give webhook time)

// Track recently processed to avoid re-triggering
const recentlyProcessed = new Set();

/**
 * Scan for unanswered conversations and process them.
 */
export async function scanUnanswered() {
    if (process.env.AI_AUTOREPLY_ENABLED !== 'true') {
        return; // Don't catch up if autoreply is off
    }

    const cutoff = new Date(Date.now() - LOOKBACK_MS).toISOString();
    const maxAge = new Date(Date.now() - MIN_AGE_MS).toISOString();

    // Find recent inbound client messages
    const { data: recentMsgs, error } = await supabase
        .from('messages')
        .select('conversation_id, content, created_at, id')
        .eq('sender_type', 'client')
        .eq('direction', 'inbound')
        .gt('created_at', cutoff)
        .lt('created_at', maxAge) // At least 1 min old
        .order('created_at', { ascending: false });

    if (error) {
        console.error('[CatchUp] Query error:', error.message);
        return;
    }

    // Deduplicate by conversation (keep latest message per conv)
    const latestByConv = new Map();
    for (const m of (recentMsgs || [])) {
        if (!latestByConv.has(m.conversation_id)) {
            latestByConv.set(m.conversation_id, m);
        }
    }

    let caught = 0;

    for (const [convId, lastMsg] of latestByConv) {
        // Skip recently processed
        if (recentlyProcessed.has(convId)) continue;

        // Check if AI already replied after this message
        const { data: aiReply } = await supabase
            .from('ai_reply_decisions')
            .select('id')
            .eq('conversation_id', convId)
            .eq('reply_status', 'sent')
            .eq('sent_by', 'ai')
            .gt('created_at', lastMsg.created_at)
            .limit(1);

        if (aiReply && aiReply.length > 0) continue; // Already replied

        // Check if operator already replied
        const { data: opReply } = await supabase
            .from('messages')
            .select('id')
            .eq('conversation_id', convId)
            .eq('direction', 'outbound')
            .in('sender_type', ['agent', 'operator', 'human'])
            .gt('created_at', lastMsg.created_at)
            .limit(1);

        if (opReply && opReply.length > 0) continue; // Operator handled it

        // Check for closing signal / ack / customer paused
        const content = lastMsg.content || '';
        const normalized = content.toLowerCase().trim().replace(/[!?.]+$/g, '').trim();

        // Skip acks
        const ACK = ['ok','okay','bine','da','mhm','aha','mersi','multumesc','ms','merci','k','super','perfect','sigur'];
        if (normalized.length <= 25 && ACK.some(a => normalized === a)) continue;

        // Skip pure closing signals
        const closing = detectClosingSignal(content);
        if (closing.detected && !closing.hasOpenQuestion && !closing.hasActiveIntent) continue;

        // Skip customer paused
        const PAUSE = /^(revin eu|revin|ma mai gandesc|ok.*revin|bine.*revin|te anunt eu|mai vorbim|va anunt)$/i;
        if (normalized.length <= 35 && PAUSE.test(normalized)) continue;

        // This conversation needs a response!
        console.log(`[CatchUp] Unanswered: ${convId.substring(0, 8)} | "${content.substring(0, 40)}" | ${new Date(lastMsg.created_at).toISOString().substring(11, 19)}`);

        try {
            await processConversation(convId, `catchup-${Date.now()}`);
            caught++;
            recentlyProcessed.add(convId);
            // Clean up set periodically
            if (recentlyProcessed.size > 100) {
                const arr = [...recentlyProcessed];
                arr.slice(0, 50).forEach(id => recentlyProcessed.delete(id));
            }
        } catch (err) {
            console.error(`[CatchUp] Error processing ${convId.substring(0, 8)}:`, err.message);
        }
    }

    if (caught > 0) {
        console.log(`[CatchUp] Processed ${caught} unanswered conversation(s)`);
    }
}

// ── Runner ──
const isOnce = process.argv.includes('--once');

async function run() {
    console.log(`[CatchUp] Starting (mode=${isOnce ? 'once' : 'loop'}, lookback=${LOOKBACK_MS/60000}min, poll=${POLL_INTERVAL/1000}s)`);

    if (isOnce) {
        await scanUnanswered();
        process.exit(0);
    }

    // eslint-disable-next-line no-constant-condition
    while (true) {
        try {
            await scanUnanswered();
        } catch (err) {
            console.error('[CatchUp] Loop error:', err.message);
        }
        await new Promise(r => setTimeout(r, POLL_INTERVAL));
    }
}

const isMain = process.argv[1]?.endsWith('catchupScanner.mjs');
if (isMain) {
    run().catch(err => { console.error('[CatchUp] Fatal:', err); process.exit(1); });
}
