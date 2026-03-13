import { executeAiAction } from '../src/actions/actionExecutor.mjs';
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } from '../src/config/env.mjs';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function runTests() {
    console.log("Starting Hardening Tests...");
    
    // 1. Create a dummy event plan in DB
    const dummyConversationId = '99999999-9999-4999-8999-999999999999';
    await supabase.from('clients').upsert({ id: '99999999-9999-4999-8999-111111111111', phone: '+40000000000' });
    await supabase.from('conversations').upsert({ id: dummyConversationId, client_id: '99999999-9999-4999-8999-111111111111' });
    
    const { data: newPlan, error: insertErr } = await supabase
        .from('ai_event_plans')
        .insert({
            conversation_id: dummyConversationId,
            event_date: '2026-05-10',
            location: 'Test City',
            status: 'draft'
        })
        .select('*')
        .single();
        
    if (insertErr) {
         console.error("Failed to create mock plan:", insertErr);
         return;
    }
    
    let currentPlan = newPlan;
    
    // Helper to run action
    const run = async (action, state = 'discovery') => {
        return await executeAiAction(action, {
            conversationId: dummyConversationId,
            clientId: '99999999-9999-4999-8999-111111111111',
            goalState: { current_state: state },
            eventPlan: currentPlan
        });
    };
    
    // TEST 1: update_event_plan
    let res = await run({ name: 'update_event_plan', arguments: { children_count_estimate: 20 } });
    console.log("Test 1 (update_event_plan):", res.success ? "PASSED" : "FAILED", res.message);
    
    // Refresh plan
    const { data: updatedPlan } = await supabase.from('ai_event_plans').select('*').eq('id', currentPlan.id).single();
    currentPlan = updatedPlan;

    // TEST 2: generate_quote_draft
    res = await run({ name: 'generate_quote_draft', arguments: { target_package: 'super_3_confetti' } }, 'package_recommendation');
    console.log("Test 2 (generate_quote_draft):", res.success ? "PASSED" : "FAILED", res.message);
    
    // TEST 7: ai_event_plan_id missing but auto-injected
    res = await run({ name: 'confirm_booking_from_ai_plan', arguments: {} }, 'booking_ready');
    console.log("Test 7 (confirm_booking auto-inject ID):", res.success ? "PASSED" : "FAILED", res.message);

    // TEST 6: operator_locked blocks
    await supabase.from('ai_event_plans').update({ operator_locked: true }).eq('id', currentPlan.id);
    currentPlan.operator_locked = true;
    res = await run({ name: 'update_event_plan', arguments: { location: 'Blocked City' } });
    console.log("Test 6a (operator_locked blocks update):", res.success ? "FAILED" : "PASSED", res.message);
    
    res = await run({ name: 'confirm_booking_from_ai_plan', arguments: {} }, 'booking_ready');
    console.log("Test 6b (operator_locked blocks confirm):", res.success ? "FAILED" : "PASSED", res.message);
    
    // Unlock for next tests
    await supabase.from('ai_event_plans').update({ operator_locked: false }).eq('id', currentPlan.id);
    currentPlan.operator_locked = false;
    
    // TEST 5: archive_plan
    res = await run({ name: 'archive_plan', arguments: { reason: 'Test archive' } }, 'discovery');
    console.log("Test 5 (archive_plan):", res.success ? "PASSED" : "FAILED", res.message);
    
    // Refresh to check archive status
    const { data: archivedPlan } = await supabase.from('ai_event_plans').select('*').eq('id', currentPlan.id).single();
    currentPlan = archivedPlan;
    console.log("Archive status in DB:", currentPlan.status, currentPlan.archive_reason);
    
    // Test that archived plans block confirmation
    res = await run({ name: 'confirm_booking_from_ai_plan', arguments: {} }, 'booking_ready');
    console.log("Test 8 (archived blocks confirm):", res.success ? "FAILED" : "PASSED", res.message);

    console.log("Hardening Tests Complete.");
}

await runTests();
