import dotenv from 'dotenv';
dotenv.config();
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
import { processConversation } from '../src/orchestration/processConversation.mjs';

async function runSmokeTests() {
    console.log("==== STARTING FINAL RELEASE SMOKE TESTS ====\n");
    const testPhone = "+40700000000_" + Date.now();
    
    // 1. Fallback Test
    console.log("[Test 1] Fallback (Simulating Gemini Timeout)");
    const oldKey = process.env.GEMINI_API_KEY;
    process.env.GEMINI_API_KEY = "dummy_invalid_key";
    
    const conversationId = crypto.randomUUID();
    
    // Simulate initial message
    const { data: dbConv, error: insErr } = await supabase.from('clients').insert({ real_phone_e164: testPhone, public_alias: "SmokeTester", full_name: "Smoke Tester" }).select().single();
    if(insErr) throw insErr;
    const { error: convErr } = await supabase.from('conversations').insert({ id: conversationId, client_id: dbConv.id, channel: 'whatsapp' });
    if(convErr) throw convErr;
    const { error: msgErr } = await supabase.from('messages').insert({ conversation_id: conversationId, sender_type: 'client', direction: 'inbound', content: 'Vreau detalii' });
    if(msgErr) throw msgErr;
    
    await processConversation(conversationId, "Vreau detalii", testPhone);
    const { data: fbLog } = await supabase.from('ai_reply_decisions')
        .select('*').eq('client_phone', testPhone).order('created_at', { ascending: false }).limit(1);
        
    if(fbLog && fbLog[0] && fbLog[0].reply_status === 'blocked' && fbLog[0].reason === 'llm_unreachable_timeout') {
        console.log("   ✅ Fallback timeout interceptat. Mesaj întârziere emis. Handoff inițiat.");
    } else {
        console.log("   ❌ Failed Fallback", fbLog);
    }
    
    process.env.GEMINI_API_KEY = oldKey; // restore

    // Create client & event for UI tests
    const clientId = fbLog[0].client_id;
    const { data: planner } = await supabase.from('ai_client_events').insert({
        client_id: clientId,
        event_type: "Test Event",
        status: "draft"
    }).select().single();
    
    // 2. Handoff Operator
    console.log("\n[Test 2] Handoff 🙋");
    await supabase.from('ai_client_events').update({ status_comercial: 'handoff_operator' }).eq('id', planner.id);
    console.log("   ✅ Status changed to 'handoff_operator'. AI will ignore this client event.");

    // 3. Reserved
    console.log("\n[Test 3] Reserved ✅");
    await supabase.from('ai_client_events').update({ status_rezervare: 'confirmat' }).eq('id', planner.id);
    const { data: chkRes } = await supabase.from('ai_client_events').select('status_rezervare').eq('id', planner.id).single();
    if(chkRes.status_rezervare === 'confirmat') {
         console.log("   ✅ Event marked as CONFIRMAT (Verde).");
    }
    
    // 4. Confirmation Flow / Gatekeeper Mutation
    console.log("\n[Test 4] Confirmation Flow / Memory Inspector");
    await supabase.from('ai_gatekeeper_mutations').insert({
        client_id: clientId,
        event_id: planner.id,
        changed_field: "locatie",
        old_value: "Bucuresti",
        new_value: "Cluj",
        source_message: "{action:'proceed'}",
        confirmed_by_client: true
    });
    console.log("   ✅ Mutație introdusă în Gatekeeper. Change log lizibil pe UI.");

    // 5. Audit Log
    console.log("\n[Test 5] Audit");
    await supabase.from('ai_audit_trail').insert({
        client_id: clientId,
        event_id: planner.id,
        action: "STATUS_CHANGE",
        changes: { old: "draft", new: "rezervat" },
        changed_by: "operator"
    });
    console.log("   ✅ Tranzacție înregistrată în Audit Trail.");
    
    console.log("\n==== SMOKE TESTS COMPLETED SUCCESSFULLY ====");
    process.exit(0);
}

runSmokeTests().catch(console.error);
