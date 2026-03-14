import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SECRET = process.env.MANAGER_AI_WEBHOOK_SECRET || 'dev-secret-123';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const API = 'http://89.167.115.150:3001/webhook/whts-up';

const TESTS = [
  { p: '1', msg: 'Vreau arcadă organică de 3 metri' },
  { p: '2', msg: 'Vreau arcadă cu cifre volumetrice de 4 metri' },
  { p: '3', msg: 'Vreau arcadă pe suport' }
];

async function createSupabaseData(testPayload) {
    const freshId = testPayload.id;
    const convId = testPayload.conv;
    const clientId = testPayload.conv + "_client";
    
    await supabase.from('clients').upsert({
        id: clientId,
        real_phone_e164: "+40700000000",
        full_name: "Simulated User",
        channel: "whatsapp",
        status: "active"
    });

    await supabase.from('conversations').upsert({
        id: convId,
        client_id: clientId,
        status: "open",
        channel_thread_id: testPayload.conv
    });

    await supabase.from('messages').insert({
        id: freshId,
        conversation_id: convId,
        sender_type: "client",
        content: testPayload.msg,
        message_status: "delivered",
        message_type: "text",
        direction: "inbound"
    });
}

async function run() {
    for (const test of TESTS) {
        
        const freshId = crypto.randomUUID();
        const testPayload = { id: freshId, conv: 'sim_conv_' + test.p, msg: test.msg };
        
        await createSupabaseData(testPayload);
        console.log(`\n============== SENDING TEST: ${test.msg} ==============`);
        const payload = JSON.stringify({
            message_id: freshId,
            conversation_id: testPayload.conv,
            content: test.msg,
            sender_type: "client"
        });
        
        const hash = crypto.createHmac('sha256', SECRET).update(payload).digest('hex');
        const sig = `sha256=${hash}`;
        
        const res = await fetch(API, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-hub-signature': sig },
            body: payload
        });
        
        console.log('API Status:', res.status, await res.text());
        console.log('Waiting 16s for pipeline to finish...');
        await new Promise(resolve => setTimeout(resolve, 16000));
    }
}

run().catch(console.error);
