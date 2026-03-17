import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import dotenv from 'dotenv';

dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function testFallback() {
    console.log("=== TEST FALLBACK LLM CAP-COADA ===");
    
    // Mutate environment BEFORE dynamic imports
    process.env.GEMINI_API_KEY = "invalid_key_for_testing";
    process.env.GEMINI_BASE_URL = "http://localhost:9999/v1"; // definitely unreachable
    
    const { processConversation } = await import('./src/orchestration/processConversation.mjs');

    const clientId = crypto.randomUUID();
    const convId = crypto.randomUUID();
    const msgId = crypto.randomUUID();

    console.log(`Injecting false message into DB... Conv ID: ${convId}`);
    // Setup client, conv, msg
    const {error: e1} = await supabase.from('clients').insert({ id: clientId, real_phone_e164: "+40700000000", full_name: "Fallback Test User" });
    if(e1) console.error("Client Insert Error:", e1);
    const {error: e2} = await supabase.from('conversations').insert({ id: convId, client_id: clientId, status: 'open', channel: 'whatsapp', session_id: convId });
    if(e2) console.error("Conv Insert Error:", e2);
    const {error: e3} = await supabase.from('messages').insert({ id: msgId, conversation_id: convId, sender_type: 'client', content: 'Vreau un test', direction: 'inbound', message_type: 'text' });
    if(e3) console.error("Msg Insert Error:", e3);
    
    // Wait out Supabase propagation delay
    await new Promise(r => setTimeout(r, 1500));

    console.log(`Running processConversation... (Expecting LLM failure & Fallback execution)`);
    await processConversation(convId, msgId);
    
    console.log("\n--- Checking DB for output ---");
    
    // Check outbound message
    const { data: outMsgs } = await supabase.from('messages').select('content, status').eq('conversation_id', convId).eq('direction', 'outbound');
    console.log("1. Outbound Messages sent to client:");
    console.log(outMsgs);
    
    // Check ai_reply_decisions
    const { data: decisions } = await supabase.from('ai_reply_decisions').select('suggested_reply, escalation_reason, reply_status').eq('conversation_id', convId);
    console.log("\n2. Engine Decision logs (ai_reply_decisions):");
    console.log(decisions);
    
    // Check state escalation
    const { data: state } = await supabase.from('ai_conversation_state').select('current_stage').eq('conversation_id', convId).single();
    
    console.log("\n=== TEST RESULTS ===");
    const hasOutbound = outMsgs && outMsgs.length > 0;
    const hasDecisionRow = decisions && decisions.length > 0;
    const isEscalated = hasDecisionRow && decisions[0].escalation_reason === 'llm_unreachable_timeout';

    if (hasOutbound && isEscalated) {
         console.log("✅ TEST PASS: Fallback-ul a generat mesajul outbound, si a updatat decizia la 'llm_unreachable_timeout'!");
    } else {
         console.log("❌ TEST FAIL: Nu s-au inregistrat rezultatele asteptate în DB.");
    }
}

testFallback().then(() => process.exit(0)).catch(err => {
    console.error(err);
    process.exit(1);
});
