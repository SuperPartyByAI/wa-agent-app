import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import { processConversation } from './src/orchestration/processConversation.mjs';
import dotenv from 'dotenv';
dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error("Missing DB credentials in .env");
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const TEST_PHONE = '+40' + Math.floor(100000000 + Math.random() * 900000000).toString();

async function check(res) {
    if (res.error) throw new Error("Supabase err: " + JSON.stringify(res.error));
    return res.data;
}

async function setupTestData() {
    console.log("[E2E] Setting up test data...");

    const clientId = crypto.randomUUID();
    await check(await supabase.from('ai_client_profiles').upsert({
        client_id: clientId,
        telefon_e164: TEST_PHONE,
        nume_client: 'TEST E2E CLIENT'
    }));
    
    await check(await supabase.from('clients').upsert({
        id: clientId,
        real_phone_e164: TEST_PHONE,
        full_name: 'TEST E2E CLIENT'
    }));

    const eventId1 = crypto.randomUUID();
    await check(await supabase.from('ai_client_events').insert({
        event_id: eventId1,
        client_id: clientId,
        status_eveniment: 'draft',
        nume_sarbatorit: 'Matei',
        data_evenimentului: '2024-05-20',
        is_active: true
    }));

    const eventId2 = crypto.randomUUID();
    await check(await supabase.from('ai_client_events').insert({
        event_id: eventId2,
        client_id: clientId,
        status_eveniment: 'draft',
        nume_sarbatorit: 'Andrei',
        data_evenimentului: '2024-06-15',
        is_active: true
    }));
    
    await check(await supabase.from('ai_client_memory_summary').upsert({
        client_id: clientId,
        active_events_count: 2,
        active_event_ids: [eventId1, eventId2]
    }));

    const convId = crypto.randomUUID();
    await check(await supabase.from('conversations').upsert({
        id: convId,
        client_id: clientId,
        status: "open",
        channel: "whatsapp",
        session_id: "test-session"
    }));
    
    await check(await supabase.from('ai_lead_runtime_states').upsert({
        conversation_id: convId,
        lead_state: 'oferta_trimisa', 
        primary_service: 'animatie'
    }));

    const msgId = crypto.randomUUID();
    await check(await supabase.from('messages').insert({
        id: msgId,
        conversation_id: convId,
        sender_type: "client",
        content: "Salut! Putem schimba data pe 25 August?",
        status: "delivered",
        message_type: "text",
        direction: "inbound"
    }));

    console.log(`[E2E] Setup complete. Client ID: ${clientId}, Conv ID: ${convId}`);
    return { clientId, convId, eventId1, eventId2 };
}

async function capturePayloads(clientId, convId) {
    console.log("\n==============================================");
    console.log("             E2E CAPTURE PAYLOADS             ");
    console.log("==============================================\n");

    const { data: profile } = await supabase.from('ai_client_profiles').select('*').eq('client_id', clientId);
    console.log("1. Profil Client:\n", JSON.stringify(profile, null, 2), "\n");

    const { data: events } = await supabase.from('ai_client_events').select('*').eq('client_id', clientId);
    console.log("2. Portofoliu Evenimente (ai_client_events):\n", JSON.stringify(events, null, 2), "\n");

    const { data: changeLogs } = await supabase.from('ai_event_change_log').select('*').in('event_id', events.map(e => e.event_id));
    console.log("3. Change Log Audit:\n", JSON.stringify(changeLogs, null, 2), "\n");

    const { data: memory } = await supabase.from('ai_client_memory_summary').select('*').eq('client_id', clientId);
    console.log("4. LLM Memory Summary:\n", JSON.stringify(memory, null, 2), "\n");

    const { data: drafts } = await supabase.from('ai_event_drafts').select('*').in('event_id', events.map(e => e.event_id));
    console.log("5. Draft-uri Asociate:\n", JSON.stringify(drafts, null, 2), "\n");

    const { data: replyMsg } = await supabase.from('messages').select('content').eq('conversation_id', convId).eq('direction', 'outbound').order('created_at', { ascending: false }).limit(1);
    console.log("6. Mesaj Outbound Generat (AI Reply):");
    console.log(replyMsg && replyMsg.length > 0 ? replyMsg[0].content : "NO REPLY FOUND", "\n");
    
    console.log("==============================================\n");
}

async function cleanup(clientId, convId, events) {
    console.log("[E2E] Cleaning up generated test data...");
    for (const ev of events) {
        await supabase.from('ai_event_change_log').delete().eq('event_id', ev);
        await supabase.from('ai_event_drafts').delete().eq('event_id', ev);
        await supabase.from('ai_client_events').delete().eq('event_id', ev);
    }
    await supabase.from('ai_client_memory_summary').delete().eq('client_id', clientId);
    await supabase.from('ai_client_profiles').delete().eq('client_id', clientId);
    await supabase.from('messages').delete().eq('conversation_id', convId);
    await supabase.from('ai_lead_runtime_states').delete().eq('conversation_id', convId);
    await supabase.from('conversations').delete().eq('id', convId);
    await supabase.from('clients').delete().eq('id', clientId);
    console.log("[E2E] Cleanup complete.");
}

async function runTest() {
    let ctx = null;
    try {
        ctx = await setupTestData();
        
        console.log(`[E2E] Triggering processConversation for conv ${ctx.convId}...`);
        
        const operatorPrompt = `ATENȚIE: Ignoră orice altă strategie de Playbook. ACEASTA ESTE O TESTARE. Trebuie absolut să generezi în JSON-ul final următoarea cheie exact:
"mutation_intent": {
  "type": "change_date",
  "mutation": { "target_event_id": "${ctx.eventId1}", "field": "data_evenimentului", "new_value": "2024-08-25" },
  "requires_disambiguation": false,
  "client_confirmed_mutation": true
}`;

        // This runs the real pipeline locally
        await processConversation(ctx.convId, null, operatorPrompt);
        
        // Let background Async write operations finish
        await new Promise(res => setTimeout(res, 5000));
        
        await capturePayloads(ctx.clientId, ctx.convId);
        
    } catch (e) {
        console.error("E2E Test Failed:", e);
    } finally {
        if (ctx) {
            await cleanup(ctx.clientId, ctx.convId, [ctx.eventId1, ctx.eventId2]);
        }
    }
}

runTest();
