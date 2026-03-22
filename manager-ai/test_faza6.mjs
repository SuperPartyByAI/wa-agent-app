import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

dotenv.config();
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// Mocking Fetch and external APIs
const originalFetch = global.fetch;
global.fetch = async (url, options) => {
    if (url.includes('/api/messages/send')) {
        return { ok: true, json: async () => ({ status: 'sent' }) };
    }
    return originalFetch(url, options);
};

// Import pipeline AFTER mocks
import { processConversation } from './src/orchestration/processConversation.mjs';

const TEST_PHONE = '40799999999';
let logOutput = [];

function log(msg) {
    console.log(`[TEST] ${msg}`);
    logOutput.push(msg);
}

async function simulateClientMessage(conversationId, text) {
    const msgId = crypto.randomUUID();
    const { error } = await supabase.from('messages').insert({
        id: msgId,
        conversation_id: conversationId,
        sender_type: 'client',
        direction: 'inbound',
        content: text
    });
    if (error) log(`[Error] Insert message failed: ${error.message}`);
    
    // Slight delay to ensure DB propagation locally before pipeline fetches
    await new Promise(r => setTimeout(r, 500));
    
    // Run pipeline
    await processConversation(conversationId, msgId);
}

async function setupTestConversation(testName) {
    const clientId = crypto.randomUUID();
    const convId = crypto.randomUUID();
    const sessionId = crypto.randomUUID();
    
    const { error: err1 } = await supabase.from('clients').insert({
        id: clientId,
        real_phone_e164: "+" + TEST_PHONE + Math.floor(Math.random() * 1000),
        full_name: 'Test Client ' + testName.split(' ')[0]
    });
    if (err1) throw new Error("Clients insert failed: " + err1.message);

    const { error: err2 } = await supabase.from('conversations').insert({
        id: convId,
        client_id: clientId,
        channel: 'whatsapp',
        status: 'open',
        session_id: sessionId
    });
    if (err2) throw new Error("Conversations insert failed: " + err2.message);
    
    // initial state trigger
    const { error: err3 } = await supabase.from('ai_lead_runtime_states').insert({
        conversation_id: convId,
        lead_state: 'lead_nou',
        primary_service: null
    });
    if (err3) throw new Error("Runtime states insert failed: " + err3.message);
    
    log(`\n=== Starting Test: ${testName} ===`);
    return convId;
}

async function assertState(convId, conditionName, checkFn) {
    const { data: rt } = await supabase.from('ai_lead_runtime_states').select('*').eq('conversation_id', convId).single();
    const { data: draft } = await supabase.from('party_drafts').select('*').eq('conversation_id', convId).maybeSingle();
    const { data: msgs } = await supabase.from('messages').select('*').eq('conversation_id', convId).order('created_at', { ascending: false });
    
    const lastOutbound = msgs ? msgs.find(m => m.direction === 'outbound') : null;
    
    const passed = checkFn(rt || {}, draft || {}, lastOutbound || {});
    if (passed) {
        log(`✅ ASSERT PASS: ${conditionName}`);
    } else {
        log(`❌ ASSERT FAIL: ${conditionName}`);
        log(`State Dump: ${JSON.stringify(rt)}`);
        log(`Draft Dump: ${JSON.stringify(draft)}`);
        log(`Last Outbound: ${lastOutbound?.content}`);
    }
}

async function runEdgeCases() {
    log("=== DEBUT BATERIA FAZA 6 EXTENDED EDGE CASES ===");

    // T1: Mesaj foarte vag
    const c1 = await setupTestConversation("T1 - Mesaj Foarte Vag");
    await simulateClientMessage(c1, "Buna vreau un pret");
    await assertState(c1, "Fallbacks to discovery gracefully", (rt, draft, out) => 
        rt.lead_state === 'identificare_serviciu' && out.content.toLowerCase().includes('serviciu')
    );

    // T2: Mesaj kilometric (Flood)
    const c2 = await setupTestConversation("T2 - Flood kilometric dezorientant");
    await simulateClientMessage(c2, "Buna ziua organizam o petrecere mare cu 50 de invitati si am vrea niste vata pe bat, dar intai de toate sa va intreb cum se face faza cu vremea ca ploua si oare veniti cu masina sau cum, oricum petrecerea e in Bucuresti sector 2, data ar fi 15 mai, sa imi ziceti cat costa vata");
    await assertState(c2, "Extracts core fields despite flood", (rt, draft, out) => 
        rt.primary_service === 'vata_zahar' && draft.party_data?.localitate?.toLowerCase().includes('bucuresti')
    );

    // T3: Client schimbă serviciul brusc
    const c3 = await setupTestConversation("T3 - Switch serviciu");
    await simulateClientMessage(c3, "Vreau animatori");
    await simulateClientMessage(c3, "Scuze, m-am razgandit, copilul vrea masina de popcorn, fara animatori");
    await assertState(c3, "Switches to popcorn successfully", (rt, draft, out) => 
        rt.primary_service === 'popcorn'
    );

    // T4: Schimba data si locatia brusc
    const c4 = await setupTestConversation("T4 - Switch data/locatie");
    await simulateClientMessage(c4, "Ursitoare ptr un botez in Bucuresti duminica pe 20 aug");
    await simulateClientMessage(c4, "Stati putin ca s-a decalat botezul este saptamana viitoare pe 27 si l-am mutat in ilfov la cernica");
    await assertState(c4, "Updates location and date from follow-up", (rt, draft, out) => 
        (draft?.party_data?.locatie_eveniment?.toLowerCase()?.includes('cernica')) || (draft?.party_data?.localitate?.toLowerCase()?.includes('cernica'))
    );

    // T5: M-am intors trigger
    const c5 = await setupTestConversation("T5 - Trigger pauza si revenir");
    await simulateClientMessage(c5, "Cat e arcada?");
    await simulateClientMessage(c5, "Lasati ca revin eu maine"); // Should Pause
    await assertState(c5, "Blocked automatically on revin eu", (rt) => rt.do_not_followup === true && rt.closed_status === 'open');
    await simulateClientMessage(c5, "M-am intors, vreau arcada!"); // Should unpause
    await assertState(c5, "Unpaused after explicit return", (rt) => rt.do_not_followup === false);

    // T6: Abandoned resuscitat
    const c6 = await setupTestConversation("T6 - Abandoned Magic Resuscitate");
    await supabase.from('ai_lead_runtime_states').update({ closed_status: 'abandoned', followup_status: 'stopped' }).eq('conversation_id', c6);
    await simulateClientMessage(c6, "Mai este valabil anuntul vostru? Vreau vata de zahar"); // Must trigger Reopen logic
    await assertState(c6, "Reopened successfully to Open status", (rt) => rt.closed_status === 'open' && rt.lead_state !== 'abandoned');

    // T7: Operator takeover activ block LLM
    const c7 = await setupTestConversation("T7 - Operator Handled Bypass");
    await supabase.from('ai_lead_runtime_states').update({ closed_status: 'operator_owned' }).eq('conversation_id', c7);
    await simulateClientMessage(c7, "Buna vream sa va intreb...");
    await assertState(c7, "Stayed operator owned, AI ignored", (rt, d, out) => rt.closed_status === 'operator_owned' && (!out || out.content === undefined || !out.metadata?.is_ai));

    // T9: Cerere de reducere + draft incomplet
    const c9 = await setupTestConversation("T9 - Objection (Prea scump) / Incomplet");
    await simulateClientMessage(c9, "Vreau vata dar 500 de lei e prea scump la ce oferte am mai primit");
    await assertState(c9, "Handles objection without hallucinating fake price", (rt, d, out) => 
        out?.content?.toLowerCase()?.includes('calitat') || out?.content?.toLowerCase()?.includes('inteleg') || out?.content?.includes('coleg') || rt?.handoff_to_operator === true
    );

    // T12: Halucinatie / Serviciu Necunoscut Handoff
    const c12 = await setupTestConversation("T12 - Halucinatie Serviciu");
    await simulateClientMessage(c12, "Organizati nunti in aer liber cu corturi si manele?");
    await assertState(c12, "Rejects neatly without faking capability or handing off", (rt, d, out) => 
       rt?.handoff_to_operator === true || out?.content?.toLowerCase()?.includes('coleg') || out?.content?.toLowerCase()?.includes('nunti')
    );

    // T13: Client nervos
    const c13 = await setupTestConversation("T13 - Client extrem de furios");
    await simulateClientMessage(c13, "E O BATAIE DE JOC VREAU SA VORBESC CU CINEVA IMEDIAT");
    await assertState(c13, "Force Handoff to escalation queue", (rt) => rt.closed_status === 'operator_owned' || rt.handoff_to_operator === true);

    // T15: Dead end block
    const c15 = await setupTestConversation("T15 - Closed strict block");
    await supabase.from('ai_lead_runtime_states').update({ closed_status: 'won' }).eq('conversation_id', c15);
    await simulateClientMessage(c15, "Multumesc mult pentru eveniment, a fost super!"); // Should not trigger AI to try selling again
    await assertState(c15, "Status remains WON", (rt, d, out) => rt.closed_status === 'won');

    log("\n=== TEST BATCH COMPLETE ===");
    process.exit(0);
}

runEdgeCases().catch(e => {
    console.error(e);
    process.exit(1);
});
