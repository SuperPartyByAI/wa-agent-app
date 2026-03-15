import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import { processConversation } from './src/orchestration/processConversation.mjs';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://jrfhprnuxxfwkwjwdsez.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const TESTS = [
    { 
        desc: 'TEST 1 - ANIMATIE', 
        msg: 'Vreau Spiderman pe 12 aprilie la ora 17, în București, pentru 15 copii. Sărbătoritul este Matei, face 6 ani. Plătim cash.' 
    },
    { 
        desc: 'TEST 2 - ARCADA FARA SUPORT', 
        msg: 'Vreau arcadă organică de 4 metri, roz cu alb, pentru 10 mai, în Popești.' 
    },
    { 
        desc: 'TEST 3 - FACTURARE', 
        // Simulated consecutive conversation: first ask for billing, then they give it all
        msg: 'Da, vrem factură pe firmă. Nume firma SC Hatz SRL, CUI RO123456, email ion@hatz.ro, persoana Ion, adresa Bucuresti vizavi de mall.'
    },
    { 
        desc: 'TEST 4 - VATA DE ZAHAR', 
        msg: 'Vreau vată de zahăr pe 20 aprilie, în Ilfov, pentru 3 ore.' 
    }
];

async function runTest(test) {
    console.log(`\n======================================================`);
    console.log(`[▶️ START] ${test.desc}`);
    console.log(`[💬 MSG] "${test.msg}"`);
    console.log(`======================================================\n`);

    const convId = crypto.randomUUID();
    const clientId = crypto.randomUUID();
    const mockPhone = "+4070" + Math.floor(Math.random() * 10000000).toString();

    // Setup Mock Client & DB Session
    await supabase.from('clients').insert({ id: clientId, real_phone_e164: mockPhone, full_name: "Phase3 Simulator" });
    await supabase.from('conversations').insert({ id: convId, client_id: clientId, status: "open", channel: "whatsapp", session_id: convId });

    // Inject message
    const msgId = crypto.randomUUID();
    await supabase.from('messages').insert({
        id: msgId, conversation_id: convId, sender_type: "client",
        content: test.msg, status: "delivered", message_type: "text", direction: "inbound"
    });

    try {
        // Run AI pipeline end-to-end
        await processConversation(convId, msgId);

        // Fetch resulting Party Draft directly from the Live DB
        const { data: draft, error: draftErr } = await supabase.from('ai_party_drafts').select('*').eq('conversation_id', convId).single();
        if (draftErr) console.warn("[DB Warning] " + draftErr.message);

        console.log('\n✅ [PARTY DRAFT SAVED (DB LIVE)]');
        console.dir(draft || "No draft found", { depth: null, colors: true });

        // Fetch resulting AI Reply
        const { data: reply } = await supabase.from('ai_reply_decisions')
            .select('suggested_reply, tool_action_suggested')
            .eq('conversation_id', convId)
            .order('created_at', { ascending: false }).limit(1).single();

        console.log('\n🤖 [AI RESPONSE]');
        console.dir(reply, { depth: null, colors: true });

    } catch (e) {
        console.error(`\n❌ [TEST FAILED] ${test.desc}: ${e.message}`);
    }
}

async function runAll() {
    for (const test of TESTS) {
        await runTest(test);
    }
    console.log(`\n🎉 End of Phase 3 Test Suite`);
    process.exit(0);
}

runAll();
