import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import { runFollowUpSweep } from './src/jobs/followUpJob.mjs';
import { processConversation } from './src/orchestration/processConversation.mjs';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SECRET = process.env.MANAGER_AI_WEBHOOK_SECRET || 'dev-secret-123';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const API = 'http://localhost:3001/webhook/whts-up';

// MOCK WhatsApp Sender and Gemini LLM for Sandbox tests
const originalFetch = global.fetch;
global.fetch = async (url, options) => {
    if (typeof url === 'string') {
        if (url.includes('/api/messages/send')) {
            return { ok: true, status: 200, json: async () => ({ success: true }) };
        }
        if (url.includes('/chat/completions')) {
            const mockJson = JSON.stringify({
                thought_process: "Mock",
                recommended_action: "reply_now",
                reply_draft_ro: "Agent Mock: Salut! Revin",
                confidence: 90
            });
            return {
                ok: true,
                status: 200,
                json: async () => ({
                    choices: [{ message: { content: mockJson } }]
                })
            };
        }
    }
    return originalFetch(url, options);
};

async function setupSandbox(convId) {
    const clientId = crypto.randomUUID();
    await supabase.from('clients').upsert({
        id: clientId,
        real_phone_e164: "+4070" + Math.floor(Math.random() * 10000000).toString(),
        full_name: "Test User Faza 5"
    });
    // Create random mock session_id so WhtsUp API doesn't actually broadcast WhatsApp messages to real clients
    await supabase.from('conversations').upsert({
        id: convId,
        client_id: clientId,
        status: "open",
        channel: "whatsapp",
        session_id: crypto.randomUUID()
    });
    return clientId;
}

async function simulateClientMessage(convId, text) {
    const freshId = crypto.randomUUID();
    await supabase.from('messages').insert({
        id: freshId, conversation_id: convId, sender_type: "client",
        content: text, status: "delivered", message_type: "text", direction: "inbound"
    });

    const msgObj = { message_id: freshId, conversation_id: convId, content: text, sender_type: "client" };
    console.log(`[TEST] Calling processConversation directly with: ${text}`);
    // Signature: processConversation(conversation_id, message_id)
    await processConversation(convId, freshId);
}

async function runTests() {
    console.log("=== STARTING E2E TESTS FOR FAZA 5 ===");

    // ---------------------------------------------------------
    // TEST 1: Ofertă fără răspuns 24h -> Follow-up Soft
    // ---------------------------------------------------------
    const t1Conv = crypto.randomUUID();
    await setupSandbox(t1Conv);
    const past25Hours = new Date(Date.now() - 25 * 3600 * 1000).toISOString();
    
    await supabase.from('ai_lead_runtime_states').upsert({
        conversation_id: t1Conv, lead_state: 'oferta_trimisa',
        follow_up_due_at: past25Hours, followup_status: 'pending',
        human_takeover: false, do_not_followup: false, closed_status: 'open'
    });

    console.log("\n[TEST 1] Triggering FollowUpSweep for 24h silent quote...");
    await runFollowUpSweep();
    
    const { data: lead1 } = await supabase.from('ai_lead_runtime_states').select('*').eq('conversation_id', t1Conv).single();
    if (lead1.followup_status === 'sent_1' && lead1.followup_count === 1) {
        console.log(`✅ PASS T1: Follow-up 1 sent. New Status: ${lead1.followup_status}. Next Follow-Up Due: ${lead1.follow_up_due_at}`);
    } else {
        console.log(`❌ FAIL T1: Expected sent_1, got ${lead1?.followup_status}`);
    }

    // ---------------------------------------------------------
    // TEST 2: Clientul a zis "revin eu" -> Fără Follow-up
    // ---------------------------------------------------------
    const t2Conv = crypto.randomUUID();
    await setupSandbox(t2Conv);
    await supabase.from('ai_lead_runtime_states').upsert({
        conversation_id: t2Conv, lead_state: 'oferta_trimisa',
        follow_up_due_at: null, followup_status: 'pending',
        human_takeover: false, do_not_followup: false, closed_status: 'open'
    });

    console.log("\n[TEST 2] Processing 'revin eu' client message...");
    await simulateClientMessage(t2Conv, "Multumesc frumos, revin eu maine!");
    
    const { data: lead2 } = await supabase.from('ai_lead_runtime_states').select('*').eq('conversation_id', t2Conv).single();
    if (lead2.do_not_followup === true && lead2.do_not_followup_reason === 'client_said_revin_eu') {
        console.log(`✅ PASS T2: do_not_followup flagged securely. Pipeline aborts future checks.`);
    } else {
        console.log(`❌ FAIL T2: Expected do_not_followup=true, got ${lead2?.do_not_followup}`);
    }

    // ---------------------------------------------------------
    // TEST 3: Lead HOT fără răspuns
    // ---------------------------------------------------------
    // Because followUpEngine sweeps based on the same rules, prioritizing simply means it executes without fail.
    const t3Conv = crypto.randomUUID();
    await setupSandbox(t3Conv);
    await supabase.from('ai_lead_runtime_states').upsert({
        conversation_id: t3Conv, lead_state: 'colectare_date',
        follow_up_due_at: past25Hours, followup_status: 'pending', lead_score: 90,
        human_takeover: false, do_not_followup: false, closed_status: 'open'
    });
    
    console.log("\n[TEST 3] Triggering FollowUpSweep for HOT Lead (Score 90)...");
    await runFollowUpSweep();
    
    const { data: lead3 } = await supabase.from('ai_lead_runtime_states').select('*').eq('conversation_id', t3Conv).single();
    if (lead3.followup_status === 'sent_1') {
        console.log(`✅ PASS T3: Hot Lead received proactive soft follow-up.`);
    } else {
        console.log(`❌ FAIL T3: Hot Lead was skipped.`);
    }

    // ---------------------------------------------------------
    // TEST 4: Human Takeover Activ
    // ---------------------------------------------------------
    const t4Conv = crypto.randomUUID();
    await setupSandbox(t4Conv);
    await supabase.from('ai_lead_runtime_states').upsert({
        conversation_id: t4Conv, lead_state: 'oferta_trimisa',
        follow_up_due_at: past25Hours, followup_status: 'pending',
        human_takeover: true, do_not_followup: false, closed_status: 'open'
    });
    
    console.log("\n[TEST 4] Triggering FollowUpSweep on Human Takeover lead...");
    await runFollowUpSweep();
    
    const { data: lead4 } = await supabase.from('ai_lead_runtime_states').select('*').eq('conversation_id', t4Conv).single();
    if (lead4.followup_status === 'pending') {
        console.log(`✅ PASS T4: Sweep ignored lead. Status unchanged because Human Takeover is ACTIVE.`);
    } else {
        console.log(`❌ FAIL T4: FollowUp bypassed Takeover block: ${lead4?.followup_status}`);
    }

    // ---------------------------------------------------------
    // TEST 5: Handoff Operator (Discount Pressure)
    // ---------------------------------------------------------
    const t5Conv = crypto.randomUUID();
    await setupSandbox(t5Conv);
    await supabase.from('ai_lead_runtime_states').upsert({
        conversation_id: t5Conv, lead_state: 'oferta_trimisa',
        history: ['objection'], // Ensure history has objection to trigger the hard block
        human_takeover: false, do_not_followup: false, closed_status: 'open'
    });

    console.log("\n[TEST 5] Processing aggressive discount message...");
    await simulateClientMessage(t5Conv, "e bataie de joc pretul asta, mai faceti si voi reducere sau merg in alta parte");
    
    const { data: lead5 } = await supabase.from('ai_lead_runtime_states').select('*').eq('conversation_id', t5Conv).single();
    if (lead5.handoff_to_operator === true && lead5.closed_status === 'operator_owned') {
        console.log(`✅ PASS T5: Escalated explicitly with Handoff. Reason: ${lead5.handoff_reason}. State now: ${lead5.closed_status}`);
    } else {
        console.log(`❌ FAIL T5: Expected Handoff True, got ${lead5?.handoff_to_operator} / ${lead5?.handoff_reason}`);
    }

    console.log("\n=== ALL E2E DB ASSERTS COMPLETED ===");
}

runTests().catch(console.error);
