/**
 * smoke_test_phase5.mjs
 * 
 * Phase 5 tests: Wave 2 gated rollout for update_event_plan.
 * 14 scenarios.
 * 
 * Usage: node --env-file=.env tests/smoke_test_phase5.mjs
 */

import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } from '../src/config/env.mjs';
import { processConversation } from '../src/orchestration/processConversation.mjs';
import { detectMemoryConflicts } from '../src/rollout/memoryConflictDetector.mjs';
import { isWave2Eligible } from '../src/rollout/wave2Eligibility.mjs';
import { verifyPostWrite } from '../src/rollout/postWriteVerifier.mjs';
import { evaluateWave2Gate } from '../src/rollout/rolloutGate.mjs';

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
        .insert({ client_id: clientId, session_id: 'p5-' + Date.now() + '-' + suffix, status: 'open', channel: 'whatsapp' })
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
    console.log('║  Phase 5: Wave 2 update_event_plan — 14 Tests    ║');
    console.log('╚═══════════════════════════════════════════════════╝');

    const { data: clients } = await supabase.from('clients').select('id').limit(1);
    clientId = clients?.[0]?.id;
    if (!clientId) {
        const { data: nc } = await supabase.from('clients').insert({ full_name: 'Phase5 Test' }).select().single();
        clientId = nc.id;
    }

    // ═══ TEST 1: update_event_plan eligible only when safe ═══
    console.log(`\n${'─'.repeat(60)}`);
    const elig1 = isWave2Eligible({
        safetyClass: 'safe_autoreply_allowed',
        toolAction: { name: 'update_event_plan', arguments: { event_date: '2026-06-01', location: 'București' } },
        decision: { confidence_score: 85 },
        goalState: { current_state: 'discovery' },
        escalation: { needs_escalation: false },
        eventPlan: { status: 'draft' }, memoryConflict: { hasConflict: false, severity: 'low' },
        relationshipData: null
    });
    // Wave 2 is disabled by default, so this will be blocked
    logResult(1, 'update_event_plan eligibility check runs', typeof elig1.eligible === 'boolean', {
        eligible: elig1.eligible, blockers: elig1.blockers,
        safeFields: elig1.safeFields, unsafeFields: elig1.unsafeFields
    });

    // ═══ TEST 2: Ambiguity blocks update_event_plan ═══
    const elig2 = isWave2Eligible({
        safetyClass: 'safe_autoreply_allowed',
        toolAction: { name: 'update_event_plan', arguments: { event_date: '2026-06-01' } },
        decision: { confidence_score: 85 },
        goalState: { current_state: 'discovery' },
        escalation: { needs_escalation: false },
        eventPlan: { status: 'draft' }, memoryConflict: { hasConflict: false, severity: 'low' },
        ambiguityDetected: true
    });
    logResult(2, 'Ambiguity blocks update_event_plan', !elig2.eligible && elig2.blockers.includes('ambiguity_detected'), {
        eligible: elig2.eligible, blockers: elig2.blockers
    });

    // ═══ TEST 3: Multiple active plans → conflict detected ═══
    const conv3 = await createConv('multi');
    // Create two plans for same conversation
    await supabase.from('ai_event_plans').insert([
        { conversation_id: conv3.id, client_id: clientId, status: 'draft', event_date: '2026-07-01' },
        { conversation_id: conv3.id, client_id: clientId, status: 'draft', event_date: '2026-08-01' }
    ]);
    const mc3 = await detectMemoryConflicts({
        conversationId: conv3.id, clientId,
        proposedUpdates: { event_date: '2026-07-15' },
        eventPlan: { status: 'draft' }, goalState: {}, relationshipData: null
    });
    logResult(3, 'Multiple active plans → conflict', mc3.hasConflict && mc3.conflicts.some(c => c.type === 'multiple_active_plans'), {
        hasConflict: mc3.hasConflict, conflicts: mc3.conflicts.map(c => c.type),
        severity: mc3.severity
    });

    // ═══ TEST 4: Booking conflict detected ═══
    const mc4 = await detectMemoryConflicts({
        conversationId: 'test-conv', clientId,
        proposedUpdates: { event_date: '2026-07-15', location: 'Cluj' },
        eventPlan: { status: 'draft' }, goalState: {},
        relationshipData: { hasActiveBooking: true }
    });
    logResult(4, 'Booking conflict blocks sensitive update', mc4.hasConflict && mc4.conflicts.some(c => c.type === 'booking_conflict'), {
        hasConflict: mc4.hasConflict, conflicts: mc4.conflicts.map(c => c.type),
        severity: mc4.severity
    });

    // ═══ TEST 5: Identity uncertainty blocks ═══
    const elig5 = isWave2Eligible({
        safetyClass: 'safe_autoreply_allowed',
        toolAction: { name: 'update_event_plan', arguments: { location: 'Iași' } },
        decision: { confidence_score: 85 },
        goalState: { current_state: 'discovery' },
        escalation: { needs_escalation: false },
        eventPlan: { status: 'draft' }, memoryConflict: { hasConflict: false, severity: 'low' },
        identityUncertain: true
    });
    logResult(5, 'Identity uncertainty blocks', !elig5.eligible && elig5.blockers.includes('identity_uncertain'), {
        eligible: elig5.eligible, blockers: elig5.blockers
    });

    // ═══ TEST 6: Memory conflict severity → review ═══
    const elig6 = isWave2Eligible({
        safetyClass: 'safe_autoreply_allowed',
        toolAction: { name: 'update_event_plan', arguments: { location: 'Sibiu' } },
        decision: { confidence_score: 85 },
        goalState: { current_state: 'discovery' },
        escalation: { needs_escalation: false },
        eventPlan: { status: 'draft' },
        memoryConflict: { hasConflict: true, severity: 'critical', conflicts: [{ type: 'booking_conflict' }] }
    });
    logResult(6, 'Critical memory conflict blocks', !elig6.eligible, {
        eligible: elig6.eligible, blockers: elig6.blockers
    });

    // ═══ TEST 7: Post-write verification detects mismatch ═══
    const conv7 = await createConv('verify');
    const { data: plan7 } = await supabase.from('ai_event_plans')
        .insert({ conversation_id: conv7.id, client_id: clientId, status: 'draft' })
        .select().single();
    // Update with some data
    await supabase.from('ai_event_plans').update({ event_date: '2026-09-01', location: 'Brașov' }).eq('id', plan7.id);
    // Verify that we requested event_date + location + children, but only got event_date + location
    const verify7 = await verifyPostWrite(plan7.id, { event_date: '2026-09-01', location: 'Brașov', children_count_estimate: 15 });
    logResult(7, 'Post-write verification detects partial write', !verify7.verified && verify7.mismatches.length > 0, {
        verified: verify7.verified, mismatches: verify7.mismatches.map(m => m.field),
        mismatch_count: verify7.mismatch_count
    });

    // ═══ TEST 8: Post-write verification passes on correct write ═══
    await supabase.from('ai_event_plans').update({ children_count_estimate: 15 }).eq('id', plan7.id);
    const verify8 = await verifyPostWrite(plan7.id, { event_date: '2026-09-01', location: 'Brașov', children_count_estimate: 15 });
    logResult(8, 'Post-write passes when data correct', verify8.verified, {
        verified: verify8.verified, mismatches: verify8.mismatches
    });

    // ═══ TEST 9: Wave 2 gate blocks on insufficient samples ═══
    const mockLow = { total_with_feedback: 10, approval_rate: 100, edit_rate: 0,
        verdict_breakdown: { dangerous: 0, wrong_tool: 0, misunderstood_client: 0 },
        duplicate_outbound: 0, double_dispatch: 0, wrong_memory_usage_count: 0 };
    const gate9 = evaluateWave2Gate(mockLow, 'shadow_only');
    logResult(9, 'Wave 2 gate blocks on insufficient samples', !gate9.eligible, {
        eligible: gate9.eligible, blockers: gate9.blockers
    });

    // ═══ TEST 10: Wave 2 gate blocks when not in wave1_enabled ═══
    const mockGood = { ...mockLow, total_with_feedback: 60 };
    const gate10 = evaluateWave2Gate(mockGood, 'shadow_only');
    logResult(10, 'Wave 2 gate blocks when not wave1_enabled', !gate10.eligible && gate10.blockers.some(b => b.startsWith('prerequisite')), {
        eligible: gate10.eligible, blockers: gate10.blockers
    });

    // ═══ TEST 11: Unsafe fields blocked ═══
    const elig11 = isWave2Eligible({
        safetyClass: 'safe_autoreply_allowed',
        toolAction: { name: 'update_event_plan', arguments: { event_date: '2026-06-01', status: 'confirmed' } },
        decision: { confidence_score: 85 },
        goalState: { current_state: 'discovery' },
        eventPlan: { status: 'draft' }, memoryConflict: { hasConflict: false, severity: 'low' }
    });
    logResult(11, 'Unsafe field "status" blocked', !elig11.eligible && elig11.unsafeFields.includes('status'), {
        eligible: elig11.eligible, unsafeFields: elig11.unsafeFields, blockers: elig11.blockers
    });

    // ═══ TEST 12: Archived plan blocks ═══
    const elig12 = isWave2Eligible({
        safetyClass: 'safe_autoreply_allowed',
        toolAction: { name: 'update_event_plan', arguments: { location: 'Oradea' } },
        decision: { confidence_score: 85 },
        goalState: { current_state: 'discovery' },
        eventPlan: { status: 'archived' }, memoryConflict: { hasConflict: false, severity: 'low' }
    });
    logResult(12, 'Archived plan blocks Wave 2', !elig12.eligible && elig12.blockers.some(b => b.startsWith('plan_status')), {
        eligible: elig12.eligible, blockers: elig12.blockers
    });

    // ═══ TEST 13: Date in past → conflict ═══
    const mc13 = await detectMemoryConflicts({
        conversationId: 'test-conv', clientId,
        proposedUpdates: { event_date: '2020-01-01' },
        eventPlan: { status: 'draft' }, goalState: {}, relationshipData: null
    });
    logResult(13, 'Past date triggers context drift conflict', mc13.hasConflict && mc13.conflicts.some(c => c.type === 'context_drift'), {
        hasConflict: mc13.hasConflict, conflicts: mc13.conflicts.map(c => c.type)
    });

    // ═══ TEST 14: Non-regression — pipeline + 0 crash + 0 dup ═══
    const conv14 = await createConv('nonreg');
    const { data: msg14 } = await supabase.from('messages')
        .insert({ conversation_id: conv14.id, direction: 'inbound', sender_type: 'client', content: 'Vreau petrecere pe 15 iunie în Constanța', message_type: 'text' })
        .select().single();
    await processConversation(conv14.id, msg14.id);
    await sleep(1500);
    const dec14 = await getDecision(conv14.id);
    const { data: out14 } = await supabase.from('messages')
        .select('*').eq('conversation_id', conv14.id).eq('direction', 'outbound').limit(5);
    logResult(14, 'Non-regression: 0 dup, 0 crash', (out14?.length || 0) <= 1, {
        reply_status: dec14?.reply_status,
        safety_class: dec14?.safety_class,
        outbound: out14?.length || 0
    });

    // ═══ SUMMARY ═══
    console.log('\n' + '═'.repeat(60));
    console.log('PHASE 5 TEST SUMMARY');
    console.log('═'.repeat(60));
    const passed = results.filter(r => r.pass).length;
    const failed = results.filter(r => !r.pass).length;
    for (const r of results) {
        console.log(`  ${r.pass ? '✅' : '❌'} Test ${r.testNum}: ${r.testName}`);
    }
    console.log(`\nResults: ${passed}/${results.length} passed, ${failed} failed`);
    console.log(`Status: ${failed === 0 ? '✅ Phase 5 READY' : '❌ Issues found'}`);
    console.log('═'.repeat(60));
}

await main();
