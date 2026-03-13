/**
 * smoke_test_phase2.mjs
 * 
 * Phase 2 tests: Shadow Mode, Safe Autoreply, Safety Classifier, Operator Feedback.
 * Tests 10 scenarios covering mode routing, safety classification, and feedback.
 * 
 * Usage: node --env-file=.env tests/smoke_test_phase2.mjs
 */

import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } from '../src/config/env.mjs';
import { processConversation } from '../src/orchestration/processConversation.mjs';
import { evaluateSafetyClass } from '../src/policy/evaluateSafetyClass.mjs';
import { saveOperatorFeedback, OPERATOR_VERDICTS } from '../src/feedback/operatorFeedback.mjs';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const results = [];
let clientId = null;

function logResult(testNum, testName, pass, details) {
    results.push({ testNum, testName, pass, details });
    console.log(`\n${pass ? '✅ PASS' : '❌ FAIL'} — Test ${testNum}: ${testName}`);
    for (const [k, v] of Object.entries(details || {})) {
        console.log(`  ${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`);
    }
}

async function createConv(suffix) {
    const { data } = await supabase.from('conversations')
        .insert({ client_id: clientId, session_id: 'phase2-' + Date.now() + '-' + suffix, status: 'open', channel: 'whatsapp' })
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

async function getOutbound(conversationId) {
    const { data } = await supabase.from('messages')
        .select('*').eq('conversation_id', conversationId)
        .eq('direction', 'outbound').order('created_at', { ascending: false }).limit(5);
    return data || [];
}

// ═══════════════════════════════════
// MAIN
// ═══════════════════════════════════
async function main() {
    console.log('╔═══════════════════════════════════════════════════╗');
    console.log('║   Phase 2: Shadow + Safe Autoreply — 10 Tests    ║');
    console.log('╚═══════════════════════════════════════════════════╝');

    const { data: clients } = await supabase.from('clients').select('id').limit(1);
    clientId = clients?.[0]?.id;
    if (!clientId) {
        const { data: nc } = await supabase.from('clients').insert({ full_name: 'Phase2 Test' }).select().single();
        clientId = nc.id;
    }
    console.log(`[Prereq] Client: ${clientId}`);

    // ═══ TEST 1: Safety classifier — safe class for simple greeting ═══
    console.log(`\n${'─'.repeat(60)}`);
    const safeResult = evaluateSafetyClass({
        decision: { confidence_score: 85, can_auto_reply: true, needs_human_review: false },
        toolAction: { name: 'reply_only' },
        goalState: { current_state: 'new_lead' },
        escalation: { needs_escalation: false },
        serviceConfidence: { service_detection_status: 'unknown' },
        relationshipData: null,
        eventPlan: null,
        mutation: null
    });
    logResult(1, 'Safety class SAFE for simple greeting', safeResult.safetyClass === 'safe_autoreply_allowed', {
        safety_class: safeResult.safetyClass,
        reasons: safeResult.reasons
    });

    // ═══ TEST 2: Safety classifier — review for commercial tool ═══
    const reviewResult = evaluateSafetyClass({
        decision: { confidence_score: 85, can_auto_reply: true },
        toolAction: { name: 'generate_quote_draft' },
        goalState: { current_state: 'package_recommendation' },
        escalation: { needs_escalation: false },
        serviceConfidence: { service_detection_status: 'confirmed' },
        relationshipData: null,
        eventPlan: null,
        mutation: null
    });
    logResult(2, 'Safety class REVIEW for quote tool', reviewResult.safetyClass === 'needs_operator_review', {
        safety_class: reviewResult.safetyClass,
        reasons: reviewResult.reasons
    });

    // ═══ TEST 3: Safety classifier — blocked for low confidence ═══
    const blockedResult = evaluateSafetyClass({
        decision: { confidence_score: 30 },
        toolAction: { name: 'update_event_plan' },
        goalState: { current_state: 'discovery' },
        escalation: { needs_escalation: false },
        serviceConfidence: {},
        relationshipData: null,
        eventPlan: null
    });
    logResult(3, 'Safety class BLOCKED for low confidence', blockedResult.safetyClass === 'blocked_autoreply', {
        safety_class: blockedResult.safetyClass,
        reasons: blockedResult.reasons
    });

    // ═══ TEST 4: Safety classifier — review for active booking mutation ═══
    const bookingResult = evaluateSafetyClass({
        decision: { confidence_score: 80 },
        toolAction: { name: 'update_event_plan' },
        goalState: { current_state: 'discovery' },
        escalation: { needs_escalation: false },
        serviceConfidence: {},
        relationshipData: { hasActiveBooking: true },
        eventPlan: null,
        mutation: { mutation_type: 'reschedule' }
    });
    logResult(4, 'Safety class REVIEW for booking mutation', bookingResult.safetyClass === 'needs_operator_review', {
        safety_class: bookingResult.safetyClass,
        reasons: bookingResult.reasons
    });

    // ═══ TEST 5: Pipeline — shadow mode holds reply ═══
    const conv5 = await createConv('shadow');
    await sendMsg(conv5.id, 'Bună ziua');
    const dec5 = await getDecision(conv5.id);
    const out5 = await getOutbound(conv5.id);
    logResult(5, 'Shadow mode does NOT send reply', 
        (dec5?.reply_status === 'shadow' || dec5?.reply_status === 'pending' || dec5?.reply_status === 'blocked') && out5.length === 0, {
        reply_status: dec5?.reply_status,
        operational_mode: dec5?.operational_mode,
        safety_class: dec5?.safety_class,
        outbound_count: out5.length,
        suggested_reply: dec5?.suggested_reply?.substring(0, 100)
    });

    // ═══ TEST 6: Pipeline — safety class persisted in audit ═══
    logResult(6, 'Safety class persisted in audit', !!dec5?.safety_class, {
        safety_class: dec5?.safety_class,
        safety_reasons: dec5?.safety_class_reasons,
        tool_suggested: dec5?.tool_action_suggested,
        memory_context: dec5?.memory_context_used
    });

    // ═══ TEST 7: Operator feedback saves correctly ═══
    let feedbackPass = false;
    if (dec5?.id) {
        const fbResult = await saveOperatorFeedback(dec5.id, 'approved_as_is', null, 'test feedback');
        const { data: updated } = await supabase.from('ai_reply_decisions')
            .select('operator_verdict, operator_feedback_at, operator_feedback_reason')
            .eq('id', dec5.id).single();
        feedbackPass = fbResult.success && updated?.operator_verdict === 'approved_as_is';
        logResult(7, 'Operator feedback saves correctly', feedbackPass, {
            saved: fbResult.success,
            verdict: updated?.operator_verdict,
            feedback_at: updated?.operator_feedback_at,
            reason: updated?.operator_feedback_reason
        });
    } else {
        logResult(7, 'Operator feedback saves correctly', false, { error: 'no decision_id' });
    }

    // ═══ TEST 8: Invalid feedback rejected ═══
    const badFb = await saveOperatorFeedback('fake-id', 'invalid_verdict_type');
    logResult(8, 'Invalid feedback rejected', !badFb.success, {
        success: badFb.success,
        error: badFb.error
    });

    // ═══ TEST 9: Feature flags control mode ═══
    // This test checks the env vars are parsed correctly
    const { AI_SHADOW_MODE_ENABLED, AI_SAFE_AUTOREPLY_ENABLED, AI_FULL_AUTOREPLY_ENABLED } = await import('../src/config/env.mjs');
    const detectedMode = AI_SHADOW_MODE_ENABLED ? 'shadow_mode'
        : AI_SAFE_AUTOREPLY_ENABLED ? 'safe_autoreply_mode'
        : AI_FULL_AUTOREPLY_ENABLED ? 'full_autoreply_mode'
        : 'legacy';
    logResult(9, 'Feature flags parsed correctly', typeof AI_SHADOW_MODE_ENABLED === 'boolean', {
        shadow: AI_SHADOW_MODE_ENABLED,
        safe: AI_SAFE_AUTOREPLY_ENABLED,
        full: AI_FULL_AUTOREPLY_ENABLED,
        detected_mode: detectedMode
    });

    // ═══ TEST 10: Non-regression — 0 duplicates, 0 crashes ═══
    const conv10 = await createConv('nonreg');
    await sendMsg(conv10.id, 'Vreau petrecere pe 15 mai în Cluj, 15 copii');
    const dec10 = await getDecision(conv10.id);
    const out10 = await getOutbound(conv10.id);
    const dup10 = out10.length > 1 && out10[0].content === out10[1]?.content && 
        Math.abs(new Date(out10[0].created_at) - new Date(out10[1]?.created_at)) < 5000;
    logResult(10, 'Non-regression: 0 duplicates, 0 crashes', !dup10, {
        reply_status: dec10?.reply_status,
        safety_class: dec10?.safety_class,
        outbound_count: out10.length,
        duplicate: dup10
    });

    // ═══ SUMMARY ═══
    console.log('\n' + '═'.repeat(60));
    console.log('PHASE 2 TEST SUMMARY');
    console.log('═'.repeat(60));
    const passed = results.filter(r => r.pass).length;
    const failed = results.filter(r => !r.pass).length;
    for (const r of results) {
        console.log(`  ${r.pass ? '✅' : '❌'} Test ${r.testNum}: ${r.testName}`);
    }
    console.log(`\nResults: ${passed}/${results.length} passed, ${failed} failed`);
    console.log(`Status: ${failed === 0 ? '✅ Phase 2 READY' : '❌ Issues found'}`);
    console.log('═'.repeat(60));
}

await main();
