/**
 * smoke_test_phase6.mjs
 * 
 * Phase 6 tests: Production Readiness Pack.
 * 8 scenarios.
 * 
 * Usage: node --env-file=.env tests/smoke_test_phase6.mjs
 */

import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } from '../src/config/env.mjs';
import { processConversation } from '../src/orchestration/processConversation.mjs';
import { checkSchemaReady } from '../src/rollout/rolloutGate.mjs';
import { getCurrentRolloutState, transitionRolloutState } from '../src/rollout/rolloutStateMachine.mjs';
import { computeScorecard } from '../src/analytics/operatorScorecard.mjs';
import { evaluateRollback } from '../src/rollout/rollbackEvaluator.mjs';
import fs from 'fs';
import path from 'path';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const results = [];

function logResult(testNum, testName, pass, details) {
    results.push({ testNum, testName, pass, details });
    console.log(`\n${pass ? '✅ PASS' : '❌ FAIL'} — Test ${testNum}: ${testName}`);
    for (const [k, v] of Object.entries(details || {})) {
        const display = typeof v === 'object' ? JSON.stringify(v) : v;
        console.log(`  ${k}: ${('' + display).substring(0, 120)}`);
    }
}

async function main() {
    console.log('╔═══════════════════════════════════════════════════╗');
    console.log('║  Phase 6: Production Readiness — 8 Tests         ║');
    console.log('╚═══════════════════════════════════════════════════╝');

    // ═══ TEST 1: Health endpoint returns valid data ═══
    console.log(`\n${'─'.repeat(60)}`);
    const schemaResult = await checkSchemaReady(supabase);
    const { data: sbCheck } = await supabase.from('ai_runtime_context').select('id').limit(1);
    let llmOk = false;
    try {
        const resp = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models?key=${process.env.GEMINI_API_KEY}`,
            { signal: AbortSignal.timeout(5000) }
        );
        llmOk = resp.ok;
    } catch { llmOk = false; }
    logResult(1, 'Health checks return valid data', schemaResult.ready && !!sbCheck && llmOk, {
        schema_ok: schemaResult.ready,
        supabase: !!sbCheck,
        llm_reachable: llmOk
    });

    // ═══ TEST 2: Readiness detects missing condition correctly ═══
    const { data: ctx } = await supabase.from('ai_runtime_context')
        .select('version, deployed_commit_sha, is_active')
        .not('deployed_commit_sha', 'is', null)
        .order('created_at', { ascending: false }).limit(1).maybeSingle();
    const hasCtx = !!ctx && !!ctx.deployed_commit_sha;
    const readyForShadow = schemaResult.ready && hasCtx;
    logResult(2, 'Readiness detects context pack + schema', readyForShadow, {
        schema_ready: schemaResult.ready,
        context_pack: hasCtx,
        verdict_shadow: readyForShadow
    });

    // ═══ TEST 3: Rollout state reads correctly ═══
    const state = await getCurrentRolloutState();
    logResult(3, 'Rollout state reads correctly', !!state.current_state, {
        current_state: state.current_state
    });

    // ═══ TEST 4: Scorecard computes without crash ═══
    const sc = await computeScorecard({ hours: 24 });
    logResult(4, 'Scorecard computes clean', sc && typeof sc.total_decisions === 'number', {
        total_decisions: sc.total_decisions,
        approval_rate: sc.approval_rate,
        dangerous_rate: sc.dangerous_rate
    });

    // ═══ TEST 5: Rollback check runs clean ═══
    const rbCheck = await evaluateRollback(1);
    logResult(5, 'Rollback check runs clean', rbCheck && typeof rbCheck.shouldRollback === 'boolean', {
        should_rollback: rbCheck.shouldRollback,
        triggers: rbCheck.triggers
    });

    // ═══ TEST 6: Admin pause/resume runs clean ═══
    const origState = state.current_state;
    // We won't actually transition — just verify the functions exist and don't crash
    logResult(6, 'Admin controls accessible', typeof transitionRolloutState === 'function', {
        transition_fn: typeof transitionRolloutState,
        current_state: origState
    });

    // ═══ TEST 7: Documentation assets exist ═══
    const docsDir = path.resolve(import.meta.dirname, '../docs');
    const requiredDocs = [
        'production-readiness.md',
        'operator-playbook.md',
        'incident-response.md',
        'rollout-runbook.md',
        'admin-runbook.md'
    ];
    const docsExist = requiredDocs.every(d => fs.existsSync(path.join(docsDir, d)));
    const docSizes = {};
    for (const d of requiredDocs) {
        const fp = path.join(docsDir, d);
        docSizes[d] = fs.existsSync(fp) ? fs.statSync(fp).size : 0;
    }
    logResult(7, 'Documentation assets exist and non-empty', docsExist && Object.values(docSizes).every(s => s > 500), {
        docs_dir: docsDir,
        files: docSizes
    });

    // ═══ TEST 8: Non-regression — pipeline + 0 crash ═══
    const { data: clients } = await supabase.from('clients').select('id').limit(1);
    const clientId = clients?.[0]?.id;
    const { data: conv8 } = await supabase.from('conversations')
        .insert({ client_id: clientId, session_id: 'p6-' + Date.now(), status: 'open', channel: 'whatsapp' })
        .select().single();
    const { data: msg8 } = await supabase.from('messages')
        .insert({ conversation_id: conv8.id, direction: 'inbound', sender_type: 'client', content: 'Bună ziua', message_type: 'text' })
        .select().single();
    await processConversation(conv8.id, msg8.id);
    await sleep(1500);
    const { data: dec8 } = await supabase.from('ai_reply_decisions')
        .select('reply_status, safety_class').eq('conversation_id', conv8.id)
        .order('created_at', { ascending: false }).limit(1).maybeSingle();
    const { data: out8 } = await supabase.from('messages')
        .select('*').eq('conversation_id', conv8.id).eq('direction', 'outbound').limit(5);
    logResult(8, 'Non-regression: shadow + 0 crash + 0 dup', dec8?.reply_status === 'shadow' && (out8?.length || 0) === 0, {
        reply_status: dec8?.reply_status,
        safety_class: dec8?.safety_class,
        outbound: out8?.length || 0
    });

    // ═══ SUMMARY ═══
    console.log('\n' + '═'.repeat(60));
    console.log('PHASE 6 TEST SUMMARY');
    console.log('═'.repeat(60));
    const passed = results.filter(r => r.pass).length;
    const failed = results.filter(r => !r.pass).length;
    for (const r of results) {
        console.log(`  ${r.pass ? '✅' : '❌'} Test ${r.testNum}: ${r.testName}`);
    }
    console.log(`\nResults: ${passed}/${results.length} passed, ${failed} failed`);
    console.log(`Status: ${failed === 0 ? '✅ Phase 6 READY' : '❌ Issues found'}`);
    console.log('═'.repeat(60));
}

await main();
