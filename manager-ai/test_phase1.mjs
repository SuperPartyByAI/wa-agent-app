import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import { processConversation } from './src/orchestration/processConversation.mjs';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const TESTS = [
  { desc: 'A. Simple Greeting', msg: 'Bună seara' },
  { desc: 'B. New Commercial Lead', msg: 'Vreau vată de zahăr' },
  { desc: 'C. Bundle Priority', msg: 'Vreau vată și popcorn' },
  { desc: 'D. Metric Arcade', msg: 'Vreau arcadă organică de 3 metri' },
  { desc: 'E. Acknowledgment', msg: 'ok' }
];

async function createSupabaseData(testMsg) {
    const freshId = crypto.randomUUID();
    const convId = crypto.randomUUID();
    const clientId = crypto.randomUUID();
    
    await supabase.from('clients').insert({
        id: clientId,
        real_phone_e164: "+4070" + Math.floor(Math.random() * 10000000).toString(),
        full_name: "Simulated User"
    });

    await supabase.from('conversations').insert({
        id: convId,
        client_id: clientId,
        status: "open",
        channel: "whatsapp",
        session_id: convId
    });

    await supabase.from('messages').insert({
        id: freshId,
        conversation_id: convId,
        sender_type: "client",
        content: testMsg,
        status: "delivered",
        message_type: "text",
        direction: "inbound"
    });
    
    return { convId, freshId };
}

async function run() {
    for (const test of TESTS) {
        console.log(`\n======================================================`);
        console.log(`[TEST] ${test.desc} -> "${test.msg}"`);
        console.log(`======================================================`);
        
        try {
            const { convId, freshId } = await createSupabaseData(test.msg);
            
            // Execute the pipeline locally
            await processConversation(convId, freshId);
            
            // Verify Output
            const { data: state } = await supabase
                .from('ai_lead_runtime_states')
                .select('lead_state, primary_service, next_best_action, missing_fields')
                .eq('conversation_id', convId)
                .maybeSingle();
                
            console.log('\n>>> PHASE 1 RUNTIME STATE DUMP:');
            console.log(JSON.stringify(state, null, 2));

            const { data: action } = await supabase
                .from('ai_reply_decisions')
                .select('suggested_reply, tool_action_suggested')
                .eq('conversation_id', convId)
                .order('created_at', { ascending: false })
                .limit(1)
                .maybeSingle();
                
            console.log('\n>>> LLM GENERATED ACTION:');
            console.log(JSON.stringify(action, null, 2));
            
        } catch(e) {
            console.error(`Test ${test.desc} Failed:`, e.message);
        }
    }
    console.log('\nAll tests complete.');
    process.exit(0);
}

run();
