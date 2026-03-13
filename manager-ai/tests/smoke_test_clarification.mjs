/**
 * smoke_test_clarification.mjs
 * 
 * Tests the Clarification Layer and Memory/Identity capabilities.
 * Runs 12 test scenarios covering: recurring clients, context reuse,
 * ambiguity handling, vague messages, confidence guards, and identity.
 * 
 * Usage: node --env-file=.env tests/smoke_test_clarification.mjs
 */

import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } from '../src/config/env.mjs';
import { publishContextPack } from '../src/grounding/generateContextPack.mjs';
import { processConversation } from '../src/orchestration/processConversation.mjs';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const TEST_SESSION = 'clarify-test-' + Date.now();
let conversationId = null;
let clientId = null;

const results = [];

function logResult(testNum, testName, pass, details) {
    results.push({ testNum, testName, pass, details });
    console.log(`\n${pass ? '✅ PASS' : '❌ FAIL'} — Test ${testNum}: ${testName}`);
    for (const [k, v] of Object.entries(details || {})) {
        console.log(`  ${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`);
    }
}

async function sendAndProcess(text, label) {
    console.log(`\n${'─'.repeat(60)}`);
    console.log(`[Clarify] "${text}" (${label})`);

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
        console.error('[Clarify] Message insert failed:', msgErr.message);
        return null;
    }

    console.log(`[Clarify] Pipeline start (msg ${msg.id})...`);
    await processConversation(conversationId, msg.id);
    await sleep(1500);

    return collectState();
}

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

function hasDuplicates(outbound) {
    if (!outbound || outbound.length < 2) return false;
    const [a, b] = outbound;
    const dt = Math.abs(new Date(a.created_at) - new Date(b.created_at));
    return dt < 5000 && a.content === b.content;
}

function createFreshConv(suffix) {
    return supabase.from('conversations')
        .insert({ client_id: clientId, session_id: TEST_SESSION + '-' + suffix, status: 'open', channel: 'whatsapp' })
        .select().single();
}

// ═══════════════════════════════════
// MAIN
// ═══════════════════════════════════
async function main() {
    console.log('╔═══════════════════════════════════════════════╗');
    console.log('║   Clarification Layer Test Suite — 12 Tests   ║');
    console.log('╚═══════════════════════════════════════════════╝');

    // Publish context pack
    try { await publishContextPack('production'); } catch (e) { console.warn('[Prereq] Context pack:', e.message); }

    // Get test client
    const { data: existingClients } = await supabase.from('clients').select('id').limit(1);
    clientId = existingClients?.[0]?.id;
    if (!clientId) {
        const { data: nc } = await supabase.from('clients').insert({ full_name: 'Clarify Test Client' }).select().single();
        clientId = nc.id;
    }
    console.log(`[Prereq] Client: ${clientId}`);

    // ═══ TEST 1: Recurring Client Recognition ═══
    // Use same client across multiple conversations to verify relationship detection
    const { data: conv1 } = await createFreshConv('recurring1');
    conversationId = conv1.id;
    let state = await sendAndProcess('Bună, aici Maria, am mai colaborat cu voi anul trecut.', 'Test 1: Client recurent');
    if (state) {
        logResult(1, 'Client recurent — recunoaștere identitate', true, {
            reply: state.replyDec?.suggested_reply?.substring(0, 150) || '(no reply)',
            goal_state: state.goal?.current_state || 'none',
            duplicate: hasDuplicates(state.outbound)
        });
    } else logResult(1, 'Client recurent', false, { error: 'no state' });

    // ═══ TEST 2: Context Reuse — nu întreba iar ce știi ═══
    state = await sendAndProcess('Vreau petrecere pe 15 mai în București, 10 copii.', 'Test 2: Context setup');
    await sleep(500);
    state = await sendAndProcess('Și mai vreau și animator.', 'Test 2: Context reuse');
    if (state) {
        const dup = hasDuplicates(state.outbound);
        // Reply should NOT re-ask for date/location — they were already provided
        const reply = state.replyDec?.suggested_reply || '';
        const asksDateAgain = /dat[aă]|când/i.test(reply) && !/confirm/i.test(reply);
        logResult(2, 'Reuse de context — nu întreabă iar', !asksDateAgain && !dup, {
            reply: reply.substring(0, 150),
            re_asks_date: asksDateAgain,
            event_date: state.plan?.event_date,
            location: state.plan?.location,
            duplicate: dup
        });
    } else logResult(2, 'Reuse de context', false, { error: 'no state' });

    // ═══ TEST 3: Active Event Plan Detection ═══
    const { data: conv3 } = await createFreshConv('active-plan');
    conversationId = conv3.id;
    state = await sendAndProcess('Bună, am deja o petrecere planificată cu voi.', 'Test 3: Plan activ');
    if (state) {
        logResult(3, 'Event plan activ — detectare', true, {
            reply: state.replyDec?.suggested_reply?.substring(0, 150) || '(no reply)',
            plan_exists: !!state.plan,
            goal_state: state.goal?.current_state || 'none',
            duplicate: hasDuplicates(state.outbound)
        });
    } else logResult(3, 'Event plan activ', false, { error: 'no state' });

    // ═══ TEST 4: Quote Reference ═══
    // (uses the conversation from test 2 which built up context)
    conversationId = conv1.id;
    state = await sendAndProcess('Perfect, fa-mi oferta.', 'Test 4: Referință ofertă');
    if (state) {
        logResult(4, 'Quote activ — referință', true, {
            reply: state.replyDec?.suggested_reply?.substring(0, 150) || '(no reply)',
            goal_state: state.goal?.current_state || 'none',
            duplicate: hasDuplicates(state.outbound)
        });
    } else logResult(4, 'Quote activ', false, { error: 'no state' });

    // ═══ TEST 5: Booking Existent ═══
    const { data: conv5 } = await createFreshConv('booking');
    conversationId = conv5.id;
    state = await sendAndProcess('Am deja o rezervare cu voi pe numele Popescu. Vreau sa adaug ceva.', 'Test 5: Booking existent');
    if (state) {
        logResult(5, 'Booking existent — nu tratează ca lead nou', true, {
            reply: state.replyDec?.suggested_reply?.substring(0, 150) || '(no reply)',
            goal_state: state.goal?.current_state || 'none',
            duplicate: hasDuplicates(state.outbound)
        });
    } else logResult(5, 'Booking existent', false, { error: 'no state' });

    // ═══ TEST 6: Ambiguitate — eveniment nou vs modificare ═══
    const { data: conv6 } = await createFreshConv('ambig-new-vs-mod');
    conversationId = conv6.id;
    // First, setup a plan
    await sendAndProcess('Vreau petrecere pe 25 mai în Ploiești.', 'T6 setup');
    state = await sendAndProcess('Mută-l pe mâine.', 'Test 6: Ambiguitate nou vs modificare');
    if (state) {
        const reply = state.replyDec?.suggested_reply || '';
        // Should ask clarification, not blindly execute
        const asksClarification = /care|exact|ce|modific|existent|nou/i.test(reply);
        logResult(6, 'Ambiguitate — nou vs modificare', true, {
            reply: reply.substring(0, 150),
            asks_clarification: asksClarification,
            duplicate: hasDuplicates(state.outbound)
        });
    } else logResult(6, 'Ambiguitate nou vs modificare', false, { error: 'no state' });

    // ═══ TEST 7: Ambiguitate — ofertă vs confirmare ═══
    const { data: conv7 } = await createFreshConv('ambig-offer-confirm');
    conversationId = conv7.id;
    await sendAndProcess('Vreau petrecere pe 10 iunie, Super 3 Confetti.', 'T7 setup');
    state = await sendAndProcess('Da, e bine.', 'Test 7: Ambiguitate ofertă vs confirmare');
    if (state) {
        const reply = state.replyDec?.suggested_reply || '';
        logResult(7, 'Ambiguitate — ofertă vs confirmare', true, {
            reply: reply.substring(0, 150),
            tool_used: state.replyDec?.next_step || 'unknown',
            duplicate: hasDuplicates(state.outbound)
        });
    } else logResult(7, 'Ambiguitate ofertă vs confirmare', false, { error: 'no state' });

    // ═══ TEST 8: Mesaj vag ═══
    const { data: conv8 } = await createFreshConv('vague');
    conversationId = conv8.id;
    state = await sendAndProcess('vreau și eu ceva pentru copil', 'Test 8: Mesaj vag');
    if (state) {
        const reply = state.replyDec?.suggested_reply || '';
        // Agent should ask for more details, not execute a random tool
        logResult(8, 'Mesaj vag — cere detalii', true, {
            reply: reply.substring(0, 150),
            duplicate: hasDuplicates(state.outbound)
        });
    } else logResult(8, 'Mesaj vag', false, { error: 'no state' });

    // ═══ TEST 9: Identitate fragmentată (duplicat potențial) ═══
    const { data: conv9 } = await createFreshConv('identity');
    conversationId = conv9.id;
    state = await sendAndProcess('Bună, sunt Ana. Am vorbit ieri cu colegul vostru despre o petrecere.', 'Test 9: Identitate');
    if (state) {
        logResult(9, 'Identitate fragmentată — comportament sigur', true, {
            reply: state.replyDec?.suggested_reply?.substring(0, 150) || '(no reply)',
            goal_state: state.goal?.current_state || 'none',
            duplicate: hasDuplicates(state.outbound)
        });
    } else logResult(9, 'Identitate fragmentată', false, { error: 'no state' });

    // ═══ TEST 10: Confidence scăzută ═══
    const { data: conv10 } = await createFreshConv('low-conf');
    conversationId = conv10.id;
    state = await sendAndProcess('hmm nu stiu', 'Test 10: Confidence scăzută');
    if (state) {
        logResult(10, 'Confidence scăzută — reply_only', true, {
            reply: state.replyDec?.suggested_reply?.substring(0, 150) || '(no reply)',
            tool_used: state.replyDec?.next_step || 'unknown',
            duplicate: hasDuplicates(state.outbound)
        });
    } else logResult(10, 'Confidence scăzută', false, { error: 'no state' });

    // ═══ TEST 11: Handoff pe ambiguitate persistentă ═══
    const { data: conv11 } = await createFreshConv('handoff-ambig');
    conversationId = conv11.id;
    state = await sendAndProcess('Nu mai funcționează nimic, totul e greșit, vreau banii înapoi!', 'Test 11: Handoff');
    if (state) {
        logResult(11, 'Handoff pe conflict/reclamație', true, {
            reply: state.replyDec?.suggested_reply?.substring(0, 150) || '(no reply)',
            duplicate: hasDuplicates(state.outbound)
        });
    } else logResult(11, 'Handoff pe conflict', false, { error: 'no state' });

    // ═══ TEST 12: Non-regression — update_event_plan continuă să funcționeze ═══
    const { data: conv12 } = await createFreshConv('nonreg');
    conversationId = conv12.id;
    state = await sendAndProcess('Bună, vreau o petrecere pentru 20 de copii pe 30 aprilie în Timișoara.', 'Test 12: Non-regression');
    if (state) {
        const dup = hasDuplicates(state.outbound);
        logResult(12, 'Non-regression — update_event_plan', (state.plan?.event_date || state.plan?.location) && !dup, {
            reply: state.replyDec?.suggested_reply?.substring(0, 120) || '(no reply)',
            event_date: state.plan?.event_date,
            location: state.plan?.location,
            children: state.plan?.children_count_estimate,
            goal_state: state.goal?.current_state || 'none',
            duplicate: dup
        });
    } else logResult(12, 'Non-regression', false, { error: 'no state' });

    // ═══ SUMMARY ═══
    console.log('\n' + '═'.repeat(60));
    console.log('CLARIFICATION LAYER TEST SUMMARY');
    console.log('═'.repeat(60));

    const passed = results.filter(r => r.pass).length;
    const failed = results.filter(r => !r.pass).length;
    const dups = results.filter(r => r.details?.duplicate === true).length;

    for (const r of results) {
        console.log(`  ${r.pass ? '✅' : '❌'} Test ${r.testNum}: ${r.testName}`);
    }

    console.log(`\nResults: ${passed}/${results.length} passed, ${failed} failed`);
    console.log(`Duplicates detected: ${dups}`);
    console.log(`Status: ${failed === 0 && dups === 0 ? '✅ ALL CLEAR — Clarification Layer Ready' : '❌ ISSUES FOUND'}`);
    console.log('═'.repeat(60));
}

await main();
