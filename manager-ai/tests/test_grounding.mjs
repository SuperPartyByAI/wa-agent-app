/**
 * test_grounding.mjs
 * 
 * Verification suite for the Hybrid Grounding Architecture.
 * Tests context pack generation, drift detection, executor cross-validation,
 * and dynamic prompt building.
 * 
 * Usage: node --env-file=../.env test_grounding.mjs
 */

import { generateContextPack, buildRegistrySnapshot, REGISTRY_VERSION, PROMPT_VERSION } from '../src/grounding/generateContextPack.mjs';
import { detectDrift } from '../src/grounding/detectDrift.mjs';
import { ACTION_REGISTRY } from '../src/actions/actionRegistry.mjs';
import { executeAiAction } from '../src/actions/actionExecutor.mjs';
import { buildSystemPrompt } from '../src/prompts/systemPrompt.mjs';

let passed = 0;
let failed = 0;

function assert(testName, condition, detail = '') {
    if (condition) {
        console.log(`  ✅ ${testName}`);
        passed++;
    } else {
        console.log(`  ❌ ${testName}${detail ? ': ' + detail : ''}`);
        failed++;
    }
}

console.log('\n=== Hybrid Grounding Architecture — Verification Suite ===\n');

// ── TEST 1: Context Pack generates correctly ──
console.log('Test 1: Context Pack Generation');
const pack = generateContextPack();
assert('Has deployed_commit_sha', typeof pack.deployed_commit_sha === 'string');
assert('Has action_registry_snapshot', typeof pack.action_registry_snapshot === 'object');
assert('Has action_registry_version', pack.action_registry_version === REGISTRY_VERSION);
assert('Has prompt_version', pack.prompt_version === PROMPT_VERSION);
assert('Has tool_names array', Array.isArray(pack.tool_names));
assert('Tool count matches registry', pack.tool_count === Object.keys(ACTION_REGISTRY).length);

// ── TEST 2: Registry snapshot captures all tools ──
console.log('\nTest 2: Registry Snapshot Completeness');
const snapshot = buildRegistrySnapshot();
for (const toolName of Object.keys(ACTION_REGISTRY)) {
    assert(`Snapshot contains '${toolName}'`, snapshot[toolName] !== undefined);
}

// ── TEST 3: Drift detection — no drift when matching ──
console.log('\nTest 3: Drift Detection (No Drift)');
const noDrift = detectDrift(snapshot);
assert('No drift with matching snapshot', noDrift.hasDrift === false, noDrift.details?.join('; '));

// ── TEST 4: Drift detection — catches extra tool in snapshot ──
console.log('\nTest 4: Drift Detection (Extra Tool in Snapshot)');
const extraSnapshot = { ...snapshot, fake_tool: { description: 'Ghost', riskLevel: 'safe', requiredArgs: [], optionalArgs: [], allowedGoalStates: ['*'] } };
const extraDrift = detectDrift(extraSnapshot);
assert('Detects extra tool in snapshot', extraDrift.hasDrift === true);
assert('Drift details mention fake_tool', extraDrift.details.some(d => d.includes('fake_tool')));

// ── TEST 5: Drift detection — catches missing tool from snapshot ──
console.log('\nTest 5: Drift Detection (Missing Tool from Snapshot)');
const missingSnapshot = { ...snapshot };
delete missingSnapshot.reply_only;
const missingDrift = detectDrift(missingSnapshot);
assert('Detects missing tool from snapshot', missingDrift.hasDrift === true);
assert('Drift details mention reply_only', missingDrift.details.some(d => d.includes('reply_only')));

// ── TEST 6: systemPrompt builds tools from context pack ──
console.log('\nTest 6: Dynamic Prompt Tool Injection');
const mockContextPack = {
    action_registry_snapshot: snapshot,
    action_registry_version: REGISTRY_VERSION,
    deployed_commit_sha: 'abc12345',
    prompt_version: PROMPT_VERSION
};
const prompt = buildSystemPrompt(null, { contextPack: mockContextPack });
assert('Prompt contains "reply_only"', prompt.includes('reply_only'));
assert('Prompt contains "update_event_plan"', prompt.includes('update_event_plan'));
assert('Prompt contains context pack version', prompt.includes(`context_pack v${REGISTRY_VERSION}`));
assert('Prompt contains SHA prefix', prompt.includes('SHA:abc12345'));

// ── TEST 7: systemPrompt falls back when no context pack ──
console.log('\nTest 7: Prompt Fallback (No Context Pack)');
const fallbackPrompt = buildSystemPrompt(null, { contextPack: null });
assert('Fallback prompt still contains reply_only', fallbackPrompt.includes('reply_only'));
assert('Fallback prompt still contains update_event_plan', fallbackPrompt.includes('update_event_plan'));

// ── TEST 8: Executor returns audit metadata ──
console.log('\nTest 8: Executor Audit Metadata');
const replyResult = await executeAiAction(
    { name: 'reply_only', arguments: { reason: 'testing' } },
    {
        conversationId: 'test-conv',
        clientId: 'test-client',
        goalState: { current_state: 'discovery' },
        eventPlan: null,
        contextPack: mockContextPack
    }
);
assert('Result has audit object', replyResult.audit !== undefined);
assert('Audit has context_pack_version', replyResult.audit?.context_pack_version === REGISTRY_VERSION);
assert('Audit has deployed_sha', replyResult.audit?.deployed_sha === 'abc12345');
assert('Audit has executed_at', typeof replyResult.audit?.executed_at === 'string');

// ── TEST 9: Executor rejects unknown tool with audit ──
console.log('\nTest 9: Unknown Tool Rejection');
const unknownResult = await executeAiAction(
    { name: 'nonexistent_tool', arguments: {} },
    {
        conversationId: 'test-conv',
        clientId: 'test-client',
        goalState: { current_state: 'discovery' },
        eventPlan: null,
        contextPack: mockContextPack
    }
);
assert('Unknown tool is rejected', unknownResult.success === false);
assert('Error message mentions unrecognized', unknownResult.message.includes('not recognized'));

// ── TEST 10: Executor detects drift for tool not in snapshot ──
console.log('\nTest 10: Cross-Validation Drift Warning');
const driftContextPack = {
    ...mockContextPack,
    action_registry_snapshot: { reply_only: snapshot.reply_only } // Only reply_only in snapshot
};
const driftResult = await executeAiAction(
    { name: 'update_event_plan', arguments: { location: 'Test City' } },
    {
        conversationId: 'test-conv',
        clientId: 'test-client',
        goalState: { current_state: 'discovery' },
        eventPlan: { id: 'plan-123', operator_locked: false },
        contextPack: driftContextPack
    }
);
// The action should still succeed (live code is authority) but audit should flag drift
assert('Action still processes (live code authority)', driftResult.audit !== undefined);
assert('Audit flags drift_detected', driftResult.audit?.drift_detected === true);

// ── Summary ──
console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed out of ${passed + failed} tests`);
console.log(`Status: ${failed === 0 ? '✅ ALL PASSED — Ready for grounded agent smoke test' : '❌ FAILURES DETECTED'}`);
console.log('='.repeat(50));

if (failed > 0) process.exit(1);
