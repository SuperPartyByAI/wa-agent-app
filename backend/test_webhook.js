require('dotenv').config();
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY);
const webhookSecret = process.env.MANAGER_AI_WEBHOOK_SECRET || 'dev-secret-123';
const url = process.env.MANAGER_AI_WEBHOOK_URL || 'http://91.98.16.90:3000/webhook/whts-up';

async function runTest() {
    console.log("=== INITIATING END-TO-END CANONICAL WEBHOOK TEST ===");
    
    // Get a real conversation to test against
    const { data: conv } = await supabase.from('conversations').select('id, client_id').eq('channel', 'whatsapp').order('created_at', { ascending: false }).limit(1).single();
    if (!conv) {
        console.error("[FATAL] No conversations found in DB to test against.");
        return;
    }
    
    const mockMessageId = `E2E_TEST_${Date.now()}`;
    const payload = {
        message_id: mockMessageId,
        conversation_id: conv.id,
        content: "Bună ziua, aș dori o petrecere sâmbătă viitoare pe la prânz cu Spiderman, în București. Sunt cam 15 copii.",
        sender_type: 'client',
        timestamp: new Date().toISOString()
    };
    
    console.log(`Payload prepared for Conv ID: ${conv.id}`);
    
    const bodyString = JSON.stringify(payload);
    const signature = crypto.createHmac('sha256', webhookSecret).update(bodyString).digest('hex');
    
    try {
        console.log(`Sending webhook to ${url} with SHA256 signature...`);
        const response = await fetch(url, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'X-Hub-Signature': `sha256=${signature}`
            },
            body: bodyString
        });
        
        const responseText = await response.text();
        console.log(`[Webhook Response] ${response.status}: ${responseText}`);
        
        if (response.status === 200) {
            console.log("\nWaiting 15 seconds for ManagerAi worker (Gemini) to process...");
            await new Promise(res => setTimeout(res, 15000));
            
            console.log("\n--- Checking AI DB Writes for End-To-End Proof ---");
            const { data: checkState } = await supabase.from('ai_conversation_state').select('*').eq('conversation_id', conv.id).single();
            const { data: checkMemory } = await supabase.from('ai_client_memory').select('*').eq('client_id', conv.client_id).single();
            const { data: checkDrafts } = await supabase.from('ai_event_drafts').select('*').eq('conversation_id', conv.id).single();
            const { data: checkUIs } = await supabase.from('ai_ui_schemas').select('generated_at').eq('conversation_id', conv.id).order('generated_at', { ascending: false }).limit(1).single();

            console.log(`ai_conversation_state write works: ${checkState ? 'da' : 'nu'}`);
            console.log(`ai_client_memory write works: ${checkMemory ? 'da' : 'nu'}`);
            console.log(`ai_event_drafts write works: ${checkDrafts ? 'da' : 'nu'}`);
            console.log(`ai_ui_schemas write works: ${checkUIs ? 'da' : 'nu'}`);
            
            if (!checkState) {
                console.log("\n[!] Webhook received OK, but AI worker did not hydrate tables. Check manager-ai PM2 logs on 91.98.16.90.");
            }
        }
    } catch(err) {
        console.error("[Test Failed]", err.message);
    }
}

runTest();
