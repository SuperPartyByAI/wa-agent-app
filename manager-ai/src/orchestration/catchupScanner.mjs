#!/usr/bin/env node
/**
 * Catch-Up Scanner — Unanswered Message Recovery (V2 Single Core)
 *
 * Scanează periodic baza de date pentru conversații orfane în care:
 *  - Clientul a dat un mesaj în ultimele X minute.
 *  - Niciun Om sau AI nu au mai dat un reply DUPĂ acel mesaj.
 *  - Mesajul NU e o confirmare banală (ok, mersi, revin).
 * 
 * Injectează silențios ultimul mesaj orfan în endpoint-ul webhook intern
 * pentru ca AI Muncitor să le proceseze normal, ascunzând downtime-ul.
 */

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '../../.env') });

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const LOOKBACK_MS = Number.parseInt(process.env.AI_CATCHUP_LOOKBACK_MINUTES || '60', 10) * 60 * 1000;
const POLL_INTERVAL = Number.parseInt(process.env.AI_CATCHUP_POLL_SECONDS || '300', 10) * 1000; // Default: 300s = 5m
const MIN_AGE_MS = 60_000; // Așteptăm măcar 1 minut să-și facă webhhook-ul obișnuit treaba
const WEBHOOK_URL = 'http://localhost:3001/webhook/whts-up';

const recentlyProcessed = new Set();

export async function scanUnanswered() {
    const cutoff = new Date(Date.now() - LOOKBACK_MS).toISOString();
    const maxAge = new Date(Date.now() - MIN_AGE_MS).toISOString();

    // 1. Extrag mesajele clienților
    const { data: recentMsgs, error } = await supabase
        .from('messages')
        .select('conversation_id, content, created_at, id, external_message_id')
        .eq('sender_type', 'client')
        .eq('direction', 'inbound')
        .gt('created_at', cutoff)
        .lt('created_at', maxAge)
        .order('created_at', { ascending: false });

    if (error) {
        console.error('[CatchUp] Eroare baze de date:', error.message);
        return;
    }

    // 2. Extrage doar cel mai recent mesaj per conversație
    const latestByConv = new Map();
    for (const m of (recentMsgs || [])) {
        if (!latestByConv.has(m.conversation_id)) {
            latestByConv.set(m.conversation_id, m);
        }
    }

    let caught = 0;

    for (const [convId, lastMsg] of latestByConv) {
        if (recentlyProcessed.has(convId)) continue;

        // 3. AI-ul a răspuns după acest mesaj?
        const { data: aiReply } = await supabase
            .from('ai_reply_decisions')
            .select('id')
            .eq('conversation_id', convId)
            .eq('reply_status', 'sent')
            .in('sent_by', ['vertex', 'ai'])
            .gt('created_at', lastMsg.created_at)
            .limit(1);

        if (aiReply && aiReply.length > 0) continue;

        // Omul (Operatorul) a răspuns după acest mesaj?
        const { data: opReply } = await supabase
            .from('messages')
            .select('id')
            .eq('conversation_id', convId)
            .eq('direction', 'outbound')
            .in('sender_type', ['agent', 'operator', 'human', 'system'])
            .gt('created_at', lastMsg.created_at)
            .limit(1);

        if (opReply && opReply.length > 0) continue;

        const content = lastMsg.content || '';
        const normalized = content.toLowerCase().trim().replace(/[!?.]+$/g, '').trim();

        // Evită răspunsuri goale (Ack/Încheieri)
        const ACK = ['ok','okay','bine','da','mhm','aha','mersi','multumesc','ms','merci','k','super','perfect','sigur', 'gata'];
        if (normalized.length <= 25 && ACK.some(a => normalized === a)) continue;

        const PAUSE = /^(revin eu|revin|ma mai gandesc|ok.*revin|bine.*revin|te anunt eu|mai vorbim|va anunt)$/i;
        if (normalized.length <= 35 && PAUSE.test(normalized)) continue;

        console.log(`[CatchUp] 🎣 Conversație orfană depistată: ${convId.substring(0, 8)} | "${content.substring(0, 40)}..."`);

        // 4. Salvează și injectează către Webhook Intern
        try {
            const payload = {
                message_id: lastMsg.external_message_id || `catchup-${Date.now()}`,
                conversation_id: convId,
                sender_phone: null, // Motorul API se prinde prin UUIDfallback
                content: content,
                sender_type: 'client'
            };

            await fetch(WEBHOOK_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            caught++;
            recentlyProcessed.add(convId);
            if (recentlyProcessed.size > 200) {
                const arr = [...recentlyProcessed];
                arr.slice(0, 50).forEach(id => recentlyProcessed.delete(id));
            }
        } catch (err) {
            console.error(`[CatchUp] Eraore injecție webhook ${convId}:`, err.message);
        }
    }

    if (caught > 0) {
        console.log(`[CatchUp] ✅ Am trimis ${caught} conversații ignorate direct la AI!`);
    }
}

const isOnce = process.argv.includes('--once');

async function run() {
    process.on('unhandledRejection', (err) => console.error('[CatchUp] Unhandled rejection:', err?.message || err));
    process.on('uncaughtException', (err) => console.error('[CatchUp] Uncaught exception:', err?.message || err));

    console.log(`[CatchUp] 🚀 Paznic Activat (Interval: ${POLL_INTERVAL/1000}s, Privește: ${LOOKBACK_MS/60000}m)`);

    if (isOnce) {
        await scanUnanswered();
        process.exit(0);
    }

    // eslint-disable-next-line no-constant-condition
    while (true) {
        try { await scanUnanswered(); } catch (err) { console.error('[CatchUp] Buclă eroare:', err.message); }
        await new Promise(r => setTimeout(r, POLL_INTERVAL));
    }
}

// Rulăm bucla principală necondiționat, deoarece acest script este un executabil dedicat
run().catch(err => console.error('[CatchUp] Crăpare fatală:', err.message));
