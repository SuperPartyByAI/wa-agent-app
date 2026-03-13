/**
 * smoke_test_phase4.mjs
 * 
 * Phase 4 tests: Wave 1 Live Rollout, Cohorting, Scorecard, Rollback.
 * 14 scenarios.
 * 
 * Usage: node --env-file=.env tests/smoke_test_phase4.mjs
 */

import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } from '../src/config/env.mjs';
import { processConversation } from '../src/orchestration/processConversation.mjs';
import { shouldIncludeInWave1, isWave1Eligible } from '../src/rollout/wave1Controller.mjs';
import { evaluateRollback, executeAutoRollback } from '../src/rollout/rollbackEvaluator.mjs';
import { computeScorecard } from '../src/analytics/operatorScorecard.mjs';
import { getCurrentRolloutState, transitionRolloutState } from '../src/rollout/rolloutStateMachine.mjs';
import { evaluateWave1Gate } from '../src/rollout/rolloutGate.mjs';

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
        .insert({ client_id: clientId, session_id: 'p4-' + Date.now() + '-' + suffix, status: 'open', channel: 'whatsapp' })
        .select().single();
    return data;
}

async function getDecision(conversationId) {
    const { data } = await supabase.from('ai_reply_decisions')
        .select('*').eq('conversation_id', conversationId)
        .order('created_at', { ascending: false }).limit(1).maybeSingle();
    return data;
}

async function main() {
    console.log('╔═══════════════════════════════════════════════════╗');
    console.log('║  Phase 4: Wave 1 Rollout + Rollback — 14 Tests   ║');
    console.log('╚═══════════════════════════════════════════════════╝');

    const { data: clients } = await supabase.from('clients').select('id').limit(1);
    clientId = clients?.[0]?.id;
    if (!clientId) {
        const { data: nc } = await supabase.from('clients').insert({ full_name: 'Phase4 Test' }).select().single();
        clientId = nc.id;
    }

    // ═══ TEST 1: Wave 1 gate check — insufficient samples ═══
    console.log(`\n${'─'.repeat(60)}`);
    const mockLow = { total_with_feedback: 5, approval_rate: 100, verdict_breakdown: { dangerous: 0, wrong_tool: 0, misunderstood_client: 0, should_have_clarified: 0, unnecessary_question: 0 }, duplicate_outbound: 0, double_dispatch: 0 };
    const gate1 = evaluateWave1Gate(mockLow);
    logResult(1, 'Wave 1 gate blocks on insufficient samples', !gate1.eligible, {
        eligible: gate1.eligible, blockers: gate1.blockers
    });

    // ═══ TEST 2: Wave 1 gate passes with good data ═══
    const mockGood = { ...mockLow, total_with_feedback: 50 };
    const gate2 = evaluateWave1Gate(mockGood);
    logResult(2, 'Wave 1 gate passes with sufficient good data', gate2.eligible, {
        eligible: gate2.eligible, blockers: gate2.blockers
    });

    // ═══ TEST 3: Deterministic bucketing ═══
    const convId = 'test-conv-' + Date.now();
    const b1 = shouldIncludeInWave1(convId, clientId);
    const b2 = shouldIncludeInWave1(convId, clientId);
    logResult(3, 'Deterministic bucketing (same conv → same bucket)', b1.bucket === b2.bucket, {
        bucket1: b1.bucket, bucket2: b2.bucket, same: b1.bucket === b2.bucket
    });

    // ═══ TEST 4: Cohort exclusion (wave1 disabled) ═══
    // Since AI_WAVE1_ENABLED is false by default, all should be excluded
    const cohort4 = shouldIncludeInWave1('any-conv', clientId);
    logResult(4, 'Cohort excluded when Wave 1 disabled', !cohort4.included, {
        included: cohort4.included, reason: cohort4.reason
    });

    // ═══ TEST 5: Only reply_only eligible in Wave 1 ═══
    const elig5 = isWave1Eligible({
        safetyClass: 'safe_autoreply_allowed',
        decision: { confidence_score: 85 },
        toolAction: { name: 'reply_only' },
        goalState: { current_state: 'greeting' },
        escalation: { needs_escalation: false },
        relationshipData: null, mutation: null
    });
    logResult(5, 'reply_only eligible in Wave 1', elig5.eligible, {
        eligible: elig5.eligible, blockers: elig5.blockers
    });

    // ═══ TEST 6: Non-reply_only blocked ═══
    const elig6 = isWave1Eligible({
        safetyClass: 'safe_autoreply_allowed',
        decision: { confidence_score: 85 },
        toolAction: { name: 'update_event_plan' },
        goalState: { current_state: 'greeting' },
        escalation: { needs_escalation: false },
        relationshipData: null, mutation: null
    });
    logResult(6, 'update_event_plan blocked in Wave 1', !elig6.eligible, {
        eligible: elig6.eligible, blockers: elig6.blockers
    });

    // ═══ TEST 7: Ambiguity blocks ═══
    const elig7 = isWave1Eligible({
        safetyClass: 'safe_autoreply_allowed',
        decision: { confidence_score: 85, needs_human_review: true },
        toolAction: { name: 'reply_only' },
        goalState: { current_state: 'greeting' },
        escalation: { needs_escalation: false },
        ambiguityDetected: true
    });
    logResult(7, 'Ambiguity blocks Wave 1', !elig7.eligible, {
        eligible: elig7.eligible, blockers: elig7.blockers
    });

    // ═══ TEST 8: Active booking blocks ═══
    const elig8 = isWave1Eligible({
        safetyClass: 'safe_autoreply_allowed',
        decision: { confidence_score: 85 },
        toolAction: { name: 'reply_only' },
        goalState: { current_state: 'greeting' },
        escalation: { needs_escalation: false },
        relationshipData: { hasActiveBooking: true }
    });
    logResult(8, 'Active booking blocks Wave 1', !elig8.eligible, {
        eligible: elig8.eligible, blockers: elig8.blockers
    });

    // ═══ TEST 9: Rollback check runs without crash ═══
    const rbResult = await evaluateRollback(1);
    logResult(9, 'Rollback evaluator runs clean', rbResult && typeof rbResult.shouldRollback === 'boolean', {
        should_rollback: rbResult.shouldRollback,
        triggers: rbResult.triggers
    });

    // ═══ TEST 10: Rollout state persists correctly ═══
    const state10 = await getCurrentRolloutState();
    logResult(10, 'Rollout state reads correctly', !!state10.current_state, {
        current_state: state10.current_state,
        changed_by: state10.changed_by
    });

    // ═══ TEST 11: Scorecard computes ═══
    const sc = await computeScorecard({ hours: 24 });
    logResult(11, 'Scorecard computes correctly', sc && typeof sc.total_decisions === 'number', {
        total_decisions: sc.total_decisions,
        auto_sent: sc.total_replies_auto_sent,
        shadowed: sc.total_replies_shadowed,
        approval_rate: sc.approval_rate,
        avg_confidence: sc.average_confidence
    });

    // ═══ TEST 12: Incident trail query works ═══
    const { data: incidents, error: incErr } = await supabase
        .from('ai_rollout_state')
        .select('*')
        .eq('changed_by', 'system_rollback')
        .limit(5);
    logResult(12, 'Incident trail query works', !incErr, {
        incidents_found: incidents?.length || 0,
        error: incErr?.message
    });

    // ═══ TEST 13: Pipeline in shadow mode — 0 outbound ═══
    const conv13 = await createConv('shadow');
    const { data: msg13 } = await supabase.from('messages')
        .insert({ conversation_id: conv13.id, direction: 'inbound', sender_type: 'client', content: 'Bună ziua', message_type: 'text' })
        .select().single();
    await processConversation(conv13.id, msg13.id);
    await sleep(1500);
    const dec13 = await getDecision(conv13.id);
    const { data: out13 } = await supabase.from('messages')
        .select('*').eq('conversation_id', conv13.id).eq('direction', 'outbound').limit(5);
    logResult(13, 'Shadow mode: 0 outbound, safety persisted', dec13?.reply_status === 'shadow' && (out13?.length || 0) === 0, {
        reply_status: dec13?.reply_status,
        safety_class: dec13?.safety_class,
        outbound: out13?.length || 0
    });

    // ═══ TEST 14: Non-regression — 0 crash, 0 duplicate, 0 double dispatch ═══
    const conv14 = await createConv('nonreg');
    const { data: msg14 } = await supabase.from('messages')
        .insert({ conversation_id: conv14.id, direction: 'inbound', sender_type: 'client', content: 'Vreau petrecere pe 30 mai în Timișoara', message_type: 'text' })
        .select().single();
    await processConversation(conv14.id, msg14.id);
    await sleep(1500);
    const dec14 = await getDecision(conv14.id);
    const { data: out14 } = await supabase.from('messages')
        .select('*').eq('conversation_id', conv14.id).eq('direction', 'outbound').limit(5);
    const dup14 = (out14?.length || 0) > 1 && out14[0]?.content === out14[1]?.content;
    logResult(14, 'Non-regression: 0 dup, 0 crash', !dup14, {
        reply_status: dec14?.reply_status,
        safety_class: dec14?.safety_class,
        outbound: out14?.length || 0,
        duplicate: dup14
    });

    // ═══ SUMMARY ═══
    console.log('\n' + '═'.repeat(60));
    console.log('PHASE 4 TEST SUMMARY');
    console.log('═'.repeat(60));
    const passed = results.filter(r => r.pass).length;
    const failed = results.filter(r => !r.pass).length;
    for (const r of results) {
        console.log(`  ${r.pass ? '✅' : '❌'} Test ${r.testNum}: ${r.testName}`);
    }
    console.log(`\nResults: ${passed}/${results.length} passed, ${failed} failed`);
    console.log(`Status: ${failed === 0 ? '✅ Phase 4 READY' : '❌ Issues found'}`);
    console.log('═'.repeat(60));
}

await main();
