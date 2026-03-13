import dotenv from 'dotenv';
dotenv.config({ path: '../.env' }); // Adjusted to run from tests/

import { processConversation } from '../src/orchestration/processConversation.mjs';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

import crypto from 'node:crypto';

async function withRetry(operation, retries = 3) {
    for (let i = 0; i < retries; i++) {
        try {
            const res = await operation();
            if (res.error) throw res.error; 
            return res;
        } catch (err) {
            if (i === retries - 1) throw err;
            console.log(`[Retry] Operation failed, retrying (${i + 1}/${retries})...`, err.message);
            await new Promise(r => setTimeout(r, 2000));
        }
    }
}

async function createMockConversation(phoneNumber, messageText) {
    // 1. First ensure a mock client exists to satisfy Foreign Key constraints
    const mockClientId = crypto.randomUUID();
    
    try {
        await withRetry(() => supabase.from('clients').upsert({
            id: mockClientId,
            real_phone_e164: phoneNumber,
            full_name: 'Test Client ' + phoneNumber,
            source: 'whatsapp'
        }));
    } catch(clientErr) {
        console.error("Client Insert Warn:", clientErr);
    }

    // 2. Insert Conversation
    let conv;
    try {
        const res = await withRetry(() => supabase.from('conversations').insert({
            client_id: mockClientId,
            channel: 'whatsapp',
            status: 'open',
            session_id: 'test-session-' + Date.now()
        }).select('id').single());
        conv = res.data;
    } catch(convErr) {
        console.error("Failed to create conv", convErr);
        process.exit(1);
    }

    // 3. Insert Goal State
    try {
        await withRetry(() => supabase.from('ai_goal_states').insert({
            conversation_id: conv.id,
            current_state: 'package_recommendation',
            previous_state: 'event_qualification'
        }));
    } catch(goalErr) {
        console.error("Goal State Insert Warn:", goalErr);
    }

    // 4. Insert Message
    const thirtySecsAgo = new Date(Date.now() - 30000).toISOString();
    try {
        await withRetry(() => supabase.from('messages').insert({
            conversation_id: conv.id,
            content: messageText,
            direction: 'inbound',
            sender_type: 'client',
            status: 'delivered',
            created_at: thirtySecsAgo
        }));
    } catch(msgErr) {
        console.error("Msg Insert Warn:", msgErr);
    }

    return conv.id;
}

async function runScenario(name, phone, messageText) {
    console.log(`\n======================================================`);
    console.log(`[SCENARIU] ${name}`);
    console.log(`[MESAJ]    "${messageText}"`);
    console.log(`======================================================\n`);
    
    const convId = await createMockConversation(phone, messageText);
    
    try {
        console.log(`[TestRunner] Invoking processConversation(${convId})`);
        await processConversation(convId, null, "TEST_FORCE_FULL_PIPELINE");
        console.log(`[TestRunner] processConversation finished`);
    } catch (err) {
        console.error("Pipeline Error:", err, err.stack);
    }
    
    // Fetch result state
    const { data: plan } = await supabase.from('ai_event_plans').select('*').eq('conversation_id', convId).single();
    const { data: quote } = await supabase.from('ai_quotes').select('*').eq('conversation_id', convId).order('created_at', { ascending: false }).limit(1).maybeSingle();
    const { data: state } = await supabase.from('ai_goal_states').select('*').eq('conversation_id', convId).single();
    const { data: outMsgs } = await supabase.from('messages').select('content').eq('conversation_id', convId).eq('direction', 'outbound').order('created_at', { ascending: false }).limit(1).maybeSingle();

    console.log(`\n--- REZULTATE (${name}) ---`);
    if (plan) {
        console.log(`Date: ${plan.event_date} | Time: ${plan.event_time} | Loc: ${plan.location} | Copii: ${plan.children_count_estimate}`);
        console.log(`Pachet: ${plan.selected_package ? plan.selected_package.package : 'None'}`);
        console.log(`Comercial: Factura=${plan.invoice_requested} | Plata=${plan.payment_method_preference} | Avans=${plan.advance_status}(${plan.advance_amount})`);
        console.log(`Readiness: Rec=${plan.readiness_for_recommendation} | Quote=${plan.readiness_for_quote} | Book=${plan.readiness_for_booking}`);
    } else {
        console.log(`Plan: N/A`);
    }

    console.log(`Goal State: ${state ? state.current_state : 'N/A'}`);
    console.log(`Quote: ${quote ? quote.grand_total + ' RON (Tr=' + quote.transport_cost + ')' : 'N/A'}`);
    console.log(`Agent Reply:\n"${outMsgs ? outMsgs.content : 'N/A'}"\n`);
}

async function runAll() {
    process.env.AI_AUTOREPLY_ENABLED = 'true'; // Allow pipeline to progress through LLM/Autonomy gates
    process.env.WHTSUP_API_URL = 'http://localhost:9999/dummy-whtsup'; // Prevent real WhatsApp sends
    process.env.AI_AUTOREPLY_CUTOFF = '2020-01-01T00:00:00.000Z'; // Override cutoff so mock tests are never blocked
    process.env.OLLAMA_URL = 'https://chat.superparty.ro/api/ai/llm'; // Use actual production LLM proxy endpoint
    console.log("Starting E2E Quotation Tests...\n");

    // Test Principal
    await runScenario(
        "SCENARIU PRINCIPAL - Complet Comercial",
        "40700000001",
        "Bună! Vreau o petrecere pentru copii pe 20 aprilie, la ora 17:00, în București, pentru 12 copii. Ne interesează pachetul Super 3 Confetti. Vreau factură pe firmă, plata prin transfer bancar și este ok un avans de 300 lei."
    );

    // Test Negativ 1
    await runScenario(
        "TEST NEGATIV 1 - Lipsesc ora/copii",
        "40700000002",
        "Bună, vreau ofertă pentru Super 3 Confetti pe 20 aprilie în București."
    );

    // Test Negativ 2
    await runScenario(
        "TEST NEGATIV 2 - Lipsește pachet",
        "40700000003",
        "Bună, vreau petrecere pe 20 aprilie la 17:00 în București pentru 12 copii."
    );

    console.log("Finished E2E Tests.");
    process.exit(0);
}

runAll();
