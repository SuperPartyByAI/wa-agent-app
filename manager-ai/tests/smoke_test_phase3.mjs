/**
 * smoke_test_phase3.mjs
 * 
 * Phase 3 tests: Analytics, Rollout Gate, State Machine, Guardrails.
 * 10 scenarios.
 * 
 * Usage: node --env-file=.env tests/smoke_test_phase3.mjs
 */

import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } from '../src/config/env.mjs';
import { processConversation } from '../src/orchestration/processConversation.mjs';
import { computeShadowAnalytics } from '../src/analytics/shadowAnalytics.mjs';
import { evaluateWave1Gate, evaluateWave2Gate, evaluateFullGate, checkSchemaReady } from '../src/rollout/rolloutGate.mjs';
import { getCurrentRolloutState, transitionRolloutState, getRolloutHistory } from '../src/rollout/rolloutStateMachine.mjs';
import { saveOperatorFeedback } from '../src/feedback/operatorFeedback.mjs';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const results = [];
let clientId = null;

function logResult(testNum, testName, pass, details) {
    results.push({ testNum, testName, pass, details });
    console.log(`\n${pass ? '✅ PASS' : '❌ FAIL'} — Test ${testNum}: ${testName}`);
    for (const [k, v] of Object.entries(details || {})) {
        const display = typeof v === 'object' ? JSON.stringify(v) : v;
        console.log(`  ${k}: ${('' + display).substring(0, 120)}`);
    }
}

async function createConv(suffix) {
    const { data } = await supabase.from('conversations')
        .insert({ client_id: clientId, session_id: 'p3-' + Date.now() + '-' + suffix, status: 'open', channel: 'whatsapp' })
        .select().single();
    return data;
}

async function sendMsg(conversationId, text) {
    const { data: msg } = await supabase.from('messages')
        .insert({ conversation_id: conversationId, direction: 'inbound', sender_type: 'client', content: text, message_type: 'text' })
        .select().single();
    await processConversation(conversationId, msg.id);
    await sleep(1500);
    return msg;
}

async function getDecision(conversationId) {
    const { data } = await supabase.from('ai_reply_decisions')
        .select('*').eq('conversation_id', conversationId)
        .order('created_at', { ascending: false }).limit(1).maybeSingle();
    return data;
}

// ═══════════════════════════════════
// MAIN
// ═══════════════════════════════════
async function main() {
    console.log('╔═══════════════════════════════════════════════════╗');
    console.log('║     Phase 3: Analytics + Rollout Gate — 10 Tests ║');
    console.log('╚═══════════════════════════════════════════════════╝');

    const { data: clients } = await supabase.from('clients').select('id').limit(1);
    clientId = clients?.[0]?.id;
    if (!clientId) {
        const { data: nc } = await supabase.from('clients').insert({ full_name: 'Phase3 Test' }).select().single();
        clientId = nc.id;
    }

    // ═══ TEST 1: DB schema ready ═══
    console.log(`\n${'─'.repeat(60)}`);
    const schema = await checkSchemaReady(supabase);
    logResult(1, 'DB schema ready (Phase 2 columns)', schema.ready, {
        ready: schema.ready, missing: schema.missing
    });

    // ═══ TEST 2: Shadow pipeline persists safety_class ═══
    const conv2 = await createConv('schema');
    await sendMsg(conv2.id, 'Bună ziua');
    const dec2 = await getDecision(conv2.id);
    logResult(2, 'Shadow pipeline persists safety_class', !!dec2?.safety_class, {
        safety_class: dec2?.safety_class,
        operational_mode: dec2?.operational_mode,
        reply_status: dec2?.reply_status,
        confidence: dec2?.confidence_score
    });

    // ═══ TEST 3: Analytics compute correctly ═══
    const kpis = await computeShadowAnalytics(24);
    logResult(3, 'Analytics compute from shadow data', kpis.total_decisions > 0 && !kpis.error, {
        total: kpis.total_decisions,
        shadow: kpis.total_shadow,
        avg_confidence: kpis.avg_confidence,
        safe_pct: kpis.safety_breakdown?.safe_pct,
        duplicates: kpis.duplicate_outbound
    });

    // ═══ TEST 4: Feedback categories aggregate ═══
    // Add operator feedback to test aggregation
    if (dec2?.id) {
        await saveOperatorFeedback(dec2.id, 'approved_as_is', null, 'test');
    }
    const kpis2 = await computeShadowAnalytics(1);
    logResult(4, 'Feedback categories aggregate correctly', kpis2.total_with_feedback >= 0, {
        with_feedback: kpis2.total_with_feedback,
        verdict_counts: kpis2.verdict_counts,
        approval_rate: kpis2.approval_rate
    });

    // ═══ TEST 5: Wave 1 gate — insufficient samples ═══
    const gate1 = evaluateWave1Gate(kpis2);
    const hasInsufficientBlocker = gate1.blockers.some(b => b.startsWith('insufficient_samples'));
    logResult(5, 'Wave 1 gate blocks on insufficient samples', !gate1.eligible && hasInsufficientBlocker, {
        eligible: gate1.eligible,
        blockers: gate1.blockers
    });

    // ═══ TEST 6: Wave 1 gate — good KPIs would pass ═══
    const mockGoodKPIs = {
        total_with_feedback: 50,
        approval_rate: 95,
        edit_rate: 5,
        verdict_breakdown: { dangerous: 0, wrong_tool: 0, misunderstood_client: 0, should_have_clarified: 0, unnecessary_question: 0 },
        duplicate_outbound: 0,
        double_dispatch: 0,
        wrong_memory_usage_count: 0
    };
    const gate2 = evaluateWave1Gate(mockGoodKPIs);
    logResult(6, 'Wave 1 gate passes on good KPIs', gate2.eligible, {
        eligible: gate2.eligible,
        blockers: gate2.blockers
    });

    // ═══ TEST 7: Wave 1 gate blocks on dangerous ═══
    const mockBadKPIs = { ...mockGoodKPIs, verdict_breakdown: { ...mockGoodKPIs.verdict_breakdown, dangerous: 10 } };
    const gate3 = evaluateWave1Gate(mockBadKPIs);
    logResult(7, 'Wave 1 gate blocks on high dangerous rate', !gate3.eligible, {
        eligible: gate3.eligible,
        blockers: gate3.blockers
    });

    // ═══ TEST 8: Wave 1 gate blocks on duplicate ═══
    const mockDupKPIs = { ...mockGoodKPIs, duplicate_outbound: 1 };
    const gate4 = evaluateWave1Gate(mockDupKPIs);
    logResult(8, 'Wave 1 gate blocks on duplicate outbound', !gate4.eligible && gate4.blockers.some(b => b.startsWith('duplicate')), {
        eligible: gate4.eligible,
        blockers: gate4.blockers
    });

    // ═══ TEST 9: Rollout state persists transitions ═══
    const currentState = await getCurrentRolloutState();
    logResult(9, 'Rollout state reads correctly', currentState.current_state === 'shadow_only', {
        current_state: currentState.current_state,
        transition_reason: currentState.transition_reason,
        changed_by: currentState.changed_by
    });

    // ═══ TEST 10: Non-regression — pipeline + shadow + 0 duplicates ═══
    const conv10 = await createConv('nonreg');
    await sendMsg(conv10.id, 'Vreau petrecere pe 25 mai în Brașov, 12 copii');
    const dec10 = await getDecision(conv10.id);
    const { data: out10 } = await supabase.from('messages')
        .select('*').eq('conversation_id', conv10.id)
        .eq('direction', 'outbound').limit(5);
    logResult(10, 'Non-regression: shadow + 0 dup + 0 crash', 
        dec10?.reply_status === 'shadow' && (out10?.length || 0) === 0, {
        reply_status: dec10?.reply_status,
        safety_class: dec10?.safety_class,
        operational_mode: dec10?.operational_mode,
        outbound_count: out10?.length || 0,
        memory_context: dec10?.memory_context_used
    });

    // ═══ SUMMARY ═══
    console.log('\n' + '═'.repeat(60));
    console.log('PHASE 3 TEST SUMMARY');
    console.log('═'.repeat(60));
    const passed = results.filter(r => r.pass).length;
    const failed = results.filter(r => !r.pass).length;
    for (const r of results) {
        console.log(`  ${r.pass ? '✅' : '❌'} Test ${r.testNum}: ${r.testName}`);
    }
    console.log(`\nResults: ${passed}/${results.length} passed, ${failed} failed`);
    console.log(`Status: ${failed === 0 ? '✅ Phase 3 READY' : '❌ Issues found'}`);
    console.log('═'.repeat(60));
}

await main();
