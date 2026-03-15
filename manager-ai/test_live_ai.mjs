import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SECRET = process.env.MANAGER_AI_WEBHOOK_SECRET || 'dev-secret-123';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const API = 'http://89.167.115.150:3001/webhook/whts-up';

const TESTS = [
  { name: 'VAGUE_INQUIRY', p: '1', msg: 'Buna ziua, facem o petrecere pentru fata mea si vrem sa chemam pe cineva.' },
  { name: 'IMPATIENT_PRICE', p: '2', msg: 'Cat ma costa animatia si baloanele?' },
  { name: 'OBJECTION_EXPENSIVE', p: '3', msg: 'e cam scump, gasesc si mai ieftin' } // We will fake the runtime state for this one inside the DB before calling the webhook
];

async function createSupabaseData(testPayload) {
    const freshId = testPayload.id;
    const convId = testPayload.conv;
    const clientId = crypto.randomUUID();
    
    // Create Client
    await supabase.from('clients').upsert({
        id: clientId,
        real_phone_e164: "+4070" + Math.floor(Math.random() * 10000000).toString(),
        full_name: "Simulated P4 User"
    });

    // Create Conv
    await supabase.from('conversations').upsert({
        id: convId,
        client_id: clientId,
        status: "open",
        channel: "whatsapp",
        session_id: testPayload.conv
    });

    // Create incoming msg
    await supabase.from('messages').insert({
        id: freshId,
        conversation_id: convId,
        sender_type: "client",
        content: testPayload.msg,
        status: "delivered",
        message_type: "text",
        direction: "inbound"
    });

    // State Injection for specific tests
    if (testPayload.name === 'OBJECTION_EXPENSIVE') {
        await supabase.from('ai_lead_runtime_states').upsert({
            conversation_id: convId,
            lead_state: 'oferta_trimisa', // Force state so Objection handler kicks in
            primary_service: 'animatie',
            known_fields: ['data_evenimentului'],
            missing_fields: [],
            lead_score: 50
        });

        // Also inject a Draft so `readyForQuote` passes true
        await supabase.from('ai_party_drafts').upsert({
             id: crypto.randomUUID(),
             conversation_id: convId,
             date_generale: { tip_eveniment: 'aniversare' },
             detalii_servicii: { animatie: { numar_animatori: 1 } },
             comercial: { gata_pentru_oferta: true, campuri_obligatorii_lipsa: [] }
        });
    }
}

async function fetchReply(convId) {
    // Wait for the webhook to process and Supabase to persist the outbound message
    await new Promise(resolve => setTimeout(resolve, 15000));
    
    const { data } = await supabase.from('messages')
        .select('*')
        .eq('conversation_id', convId)
        .eq('sender_type', 'agent')
        .order('created_at', { ascending: false })
        .limit(1);

    if (data && data.length > 0) {
        console.log(`[🤖 AI REPLY]: ${data[0].content}`);
    } else {
        console.log(`[❌ NO REPLY FOUND]`);
    }
}

async function run() {
    for (const test of TESTS) {
        const freshId = crypto.randomUUID();
        const convId = crypto.randomUUID();
        const testPayload = { id: freshId, conv: convId, msg: test.msg, name: test.name };
        
        await createSupabaseData(testPayload);
        
        console.log(`\n============== [TEST: ${test.name}] ==============`);
        console.log(`[👤 CLIENT]: ${test.msg}`);
        
        const payload = JSON.stringify({
            message_id: freshId,
            conversation_id: convId,
            content: test.msg,
            sender_type: "client"
        });
        
        const hash = crypto.createHmac('sha256', SECRET).update(payload).digest('hex');
        const sig = `sha256=${hash}`;
        
        await fetch(API, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-hub-signature': sig },
            body: payload
        });
        
        console.log('Webhook dispatched. Waiting for processing...');
        await fetchReply(convId);
    }
}

run().catch(console.error);
