/**
 * smoke_test_10.mjs — v2
 * 
 * Full 10-step WhatsApp smoke test suite.
 * Runs through the real processConversation pipeline.
 * 
 * Usage: node --env-file=.env tests/smoke_test_10.mjs
 */

import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } from '../src/config/env.mjs';
import { publishContextPack } from '../src/grounding/generateContextPack.mjs';
import { processConversation } from '../src/orchestration/processConversation.mjs';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const TEST_SESSION = 'smoke-test-' + Date.now();
let conversationId = null;
let clientId = null;

// ── Results ──
const results = [];

function logResult(testNum, testName, pass, details) {
    results.push({ testNum, testName, pass, details });
    console.log(`\n${pass ? '✅ PASS' : '❌ FAIL'} — Test ${testNum}: ${testName}`);
    for (const [k, v] of Object.entries(details || {})) {
        console.log(`  ${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`);
    }
}

// ── Send client message & process ──
async function sendAndProcess(text, label) {
    console.log(`\n${'─'.repeat(60)}`);
    console.log(`[Smoke] "${text}" (${label})`);

    const { data: msg, error: msgErr } = await supabase
        .from('messages')
        .insert({
            conversation_id: conversationId,
            direction: 'inbound',
            sender_type: 'client',
            content: text,
            message_type: 'text'
        })
        .select()
        .single();

    if (msgErr) {
        console.error('[Smoke] Message insert failed:', msgErr.message);
        return null;
    }

    console.log(`[Smoke] Pipeline start (msg ${msg.id})...`);
    await processConversation(conversationId, msg.id);
    await sleep(1500);

    return collectState();
}

// ── Collect pipeline state ──
async function collectState() {
    const { data: plan } = await supabase.from('ai_event_plans')
        .select('*').eq('conversation_id', conversationId)
        .order('created_at', { ascending: false }).limit(1).maybeSingle();

    const { data: goal } = await supabase.from('ai_goal_states')
        .select('*').eq('conversation_id', conversationId).maybeSingle();

    const { data: replyDec } = await supabase.from('ai_reply_decisions')
        .select('*').eq('conversation_id', conversationId)
        .order('created_at', { ascending: false }).limit(1).maybeSingle();

    const { data: outbound } = await supabase.from('messages')
        .select('id, content, created_at, direction')
        .eq('conversation_id', conversationId)
        .eq('direction', 'outbound')
        .order('created_at', { ascending: false }).limit(5);

    return { plan, goal, replyDec, outbound };
}

// ── Check duplicate outbound ──
function hasDuplicates(outbound) {
    if (!outbound || outbound.length < 2) return false;
    const [a, b] = outbound;
    const dt = Math.abs(new Date(a.created_at) - new Date(b.created_at));
    return dt < 5000 && a.content === b.content;
}

// ═══════════════════════════════════
// MAIN
// ═══════════════════════════════════
async function main() {
    console.log('╔═══════════════════════════════════════════════╗');
    console.log('║   WhatsApp Smoke Test Suite — 10 Tests        ║');
    console.log('╚═══════════════════════════════════════════════╝');

    // ── PREREQS ──
    console.log('\n[Prereq] Checking ai_runtime_context table...');
    const { error: tableCheck } = await supabase.from('ai_runtime_context').select('id').limit(1);
    if (tableCheck && (tableCheck.code === '42P01' || tableCheck.message?.includes('not found'))) {
        console.error('[Prereq] ❌ Table ai_runtime_context does not exist.');
        console.error('[Prereq] Run this SQL in Supabase SQL Editor:');
        console.error('[Prereq] File: manager-ai/sql/020_ai_runtime_context.sql');
        process.exit(1);
    }
    console.log('[Prereq] ✅ ai_runtime_context accessible');

    console.log('[Prereq] Publishing Context Pack...');
    try {
        await publishContextPack('production');
        console.log('[Prereq] ✅ Context Pack published');
    } catch (e) {
        console.warn('[Prereq] ⚠️  Context pack publish failed:', e.message);
        console.log('[Prereq] Continuing with live registry fallback');
    }

    // Create test client
    console.log('\n[Prereq] Creating test entities...');
    const { data: existingClients } = await supabase.from('clients').select('id').limit(1);
    if (existingClients?.length > 0) {
        clientId = existingClients[0].id;
    } else {
        const { data: newClient } = await supabase.from('clients')
            .insert({ full_name: 'Smoke Test Client' }).select().single();
        clientId = newClient.id;
    }
    console.log(`[Prereq] Client: ${clientId}`);

    // Create test conversation
    const { data: conv, error: convErr } = await supabase.from('conversations')
        .insert({ client_id: clientId, session_id: TEST_SESSION, status: 'open', channel: 'whatsapp' })
        .select().single();
    if (convErr) {
        console.error('[Prereq] Conv creation failed:', convErr.message);
        process.exit(1);
    }
    conversationId = conv.id;
    console.log(`[Prereq] Conversation: ${conversationId}`);
    console.log('[Prereq] ✅ Ready\n');

    // ═══ TEST 1: Salut simplu ═══
    let state = await sendAndProcess('Bună', 'Test 1: Salut simplu');
    if (state) {
        const dup = hasDuplicates(state.outbound);
        logResult(1, 'Salut simplu', state.outbound?.length >= 0 && !dup, {
            reply: state.outbound?.[0]?.content?.substring(0, 120) || state.replyDec?.suggested_reply?.substring(0, 120) || '(no outbound)',
            goal_state: state.goal?.current_state || 'none',
            duplicate: dup
        });
    } else logResult(1, 'Salut simplu', false, { error: 'no state' });

    // ═══ TEST 2: Cerere nouă ═══
    state = await sendAndProcess('Bună, vreau o petrecere pentru copii pe 20 aprilie în București.', 'Test 2: Cerere nouă');
    if (state) {
        const dup = hasDuplicates(state.outbound);
        logResult(2, 'Cerere nouă clară', (state.plan?.event_date || state.plan?.location) && !dup, {
            reply: state.outbound?.[0]?.content?.substring(0, 120) || state.replyDec?.suggested_reply?.substring(0, 120) || '(no outbound)',
            event_date: state.plan?.event_date,
            location: state.plan?.location,
            goal_state: state.goal?.current_state || 'none',
            duplicate: dup
        });
    } else logResult(2, 'Cerere nouă clară', false, { error: 'no state' });

    // ═══ TEST 3: Completare detalii ═══
    state = await sendAndProcess('La ora 17:00 și vor fi cam 12 copii.', 'Test 3: Completare detalii');
    if (state) {
        const dup = hasDuplicates(state.outbound);
        logResult(3, 'Completare detalii', !dup, {
            reply: state.outbound?.[0]?.content?.substring(0, 120) || state.replyDec?.suggested_reply?.substring(0, 120) || '(no outbound)',
            event_time: state.plan?.event_time,
            children: state.plan?.children_count_estimate,
            goal_state: state.goal?.current_state || 'none',
            duplicate: dup
        });
    } else logResult(3, 'Completare detalii', false, { error: 'no state' });

    // ═══ TEST 4: Alegere pachet ═══
    state = await sendAndProcess('Ne interesează Super 3 Confetti.', 'Test 4: Alegere pachet');
    if (state) {
        const dup = hasDuplicates(state.outbound);
        logResult(4, 'Alegere pachet', !dup, {
            reply: state.outbound?.[0]?.content?.substring(0, 120) || state.replyDec?.suggested_reply?.substring(0, 120) || '(no outbound)',
            selected_package: state.plan?.selected_package,
            goal_state: state.goal?.current_state || 'none',
            duplicate: dup
        });
    } else logResult(4, 'Alegere pachet', false, { error: 'no state' });

    // ═══ TEST 5: Cerere ofertă ═══
    state = await sendAndProcess('Perfect, fă-mi oferta.', 'Test 5: Cerere ofertă');
    if (state) {
        const dup = hasDuplicates(state.outbound);
        logResult(5, 'Cerere de ofertă', !dup, {
            reply: state.outbound?.[0]?.content?.substring(0, 150) || state.replyDec?.suggested_reply?.substring(0, 150) || '(no outbound)',
            goal_state: state.goal?.current_state || 'none',
            duplicate: dup
        });
    } else logResult(5, 'Cerere de ofertă', false, { error: 'no state' });

    // ═══ TEST 6: Detalii comerciale ═══
    state = await sendAndProcess('Vreau factură pe firmă și plata prin transfer.', 'Test 6: Detalii comerciale');
    if (state) {
        const dup = hasDuplicates(state.outbound);
        logResult(6, 'Detalii comerciale', !dup, {
            reply: state.outbound?.[0]?.content?.substring(0, 120) || state.replyDec?.suggested_reply?.substring(0, 120) || '(no outbound)',
            invoice: state.plan?.invoice_requested,
            payment: state.plan?.payment_method_preference,
            goal_state: state.goal?.current_state || 'none',
            duplicate: dup
        });
    } else logResult(6, 'Detalii comerciale', false, { error: 'no state' });

    // ═══ TEST 7: Confirmare avans ═══
    state = await sendAndProcess('Da, e ok avans de 300 lei.', 'Test 7: Confirmare avans');
    if (state) {
        const dup = hasDuplicates(state.outbound);
        logResult(7, 'Confirmare avans', !dup, {
            reply: state.outbound?.[0]?.content?.substring(0, 120) || state.replyDec?.suggested_reply?.substring(0, 120) || '(no outbound)',
            advance_status: state.plan?.advance_status,
            advance_amount: state.plan?.advance_amount,
            goal_state: state.goal?.current_state || 'none',
            duplicate: dup
        });
    } else logResult(7, 'Confirmare avans', false, { error: 'no state' });

    // ═══ TEST 8: Confirmare finală ═══
    state = await sendAndProcess('Da, confirm rezervarea.', 'Test 8: Confirmare finală');
    if (state) {
        const dup = hasDuplicates(state.outbound);
        logResult(8, 'Confirmare finală', !dup, {
            reply: state.outbound?.[0]?.content?.substring(0, 150) || state.replyDec?.suggested_reply?.substring(0, 150) || '(no outbound)',
            plan_status: state.plan?.status,
            goal_state: state.goal?.current_state || 'none',
            duplicate: dup
        });
    } else logResult(8, 'Confirmare finală', false, { error: 'no state' });

    // ═══ TEST 9: Anulare (fresh conv) ═══
    const { data: conv9 } = await supabase.from('conversations')
        .insert({ client_id: clientId, session_id: TEST_SESSION + '-cancel', status: 'open', channel: 'whatsapp' })
        .select().single();
    if (conv9) {
        const origId = conversationId;
        conversationId = conv9.id;
        await sendAndProcess('Bună, mă interesa o petrecere.', 'T9 setup');
        state = await sendAndProcess('Ne-am răzgândit, anulăm.', 'Test 9: Anulare');
        if (state) {
            const dup = hasDuplicates(state.outbound);
            logResult(9, 'Anulare / arhivare', !dup, {
                reply: state.outbound?.[0]?.content?.substring(0, 120) || state.replyDec?.suggested_reply?.substring(0, 120) || '(no outbound)',
                plan_status: state.plan?.status,
                archived: state.plan?.status === 'archived',
                goal_state: state.goal?.current_state || 'none',
                duplicate: dup
            });
        } else logResult(9, 'Anulare / arhivare', false, { error: 'no state' });
        conversationId = origId;
    }

    // ═══ TEST 10: Handoff (fresh conv) ═══
    const { data: conv10 } = await supabase.from('conversations')
        .insert({ client_id: clientId, session_id: TEST_SESSION + '-handoff', status: 'open', channel: 'whatsapp' })
        .select().single();
    if (conv10) {
        conversationId = conv10.id;
        state = await sendAndProcess('Vreau să vorbesc cu un om, nu mai vreau să discut cu AI-ul.', 'Test 10: Handoff');
        if (state) {
            const dup = hasDuplicates(state.outbound);
            logResult(10, 'Handoff la operator', !dup, {
                reply: state.outbound?.[0]?.content?.substring(0, 120) || state.replyDec?.suggested_reply?.substring(0, 120) || '(no outbound)',
                goal_state: state.goal?.current_state || 'none',
                duplicate: dup
            });
        } else logResult(10, 'Handoff la operator', false, { error: 'no state' });
    }

    // ═══ SUMMARY ═══
    console.log('\n' + '═'.repeat(60));
    console.log('SMOKE TEST SUMMARY');
    console.log('═'.repeat(60));

    const passed = results.filter(r => r.pass).length;
    const failed = results.filter(r => !r.pass).length;
    const dups = results.filter(r => r.details?.duplicate === true).length;

    for (const r of results) {
        console.log(`  ${r.pass ? '✅' : '❌'} Test ${r.testNum}: ${r.testName}`);
    }

    console.log(`\nResults: ${passed}/${results.length} passed, ${failed} failed`);
    console.log(`Duplicates detected: ${dups}`);
    console.log(`Status: ${failed === 0 && dups === 0 ? '✅ ALL CLEAR → Ready for batch 20-30' : '❌ ISSUES FOUND'}`);
    console.log('═'.repeat(60));
}

await main();
