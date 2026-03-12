require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const { execSync } = require('child_process');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY);

async function verifiedEpicTrace() {
    console.log("=== FINAL EPIC ROUTE VERIFICATION ===");
    
    // 1. Confirm current state of the Epic route
    const { data: epicSession } = await supabase.from('whatsapp_sessions').select('*').ilike('label', '%Epic%').limit(1).single();
    
    console.log(`Epic session_key: ${epicSession ? epicSession.session_key : 'MISSING'}`);
    if (epicSession) {
        console.log(`Epic label: ${epicSession.label}`);
        console.log(`Epic brand_key: ${epicSession.brand_key}`);
        console.log(`Epic alias_prefix: ${epicSession.alias_prefix}`);
        console.log(`Epic status: ${epicSession.status}`);
    }

    if (!epicSession) return;

    // 2. Fetch the absolute newest inbound message from a client on Epic
    const { data: latestMsg } = await supabase.from('messages')
        .select('*')
        .eq('session_id', epicSession.session_key)
        .eq('direction', 'inbound')
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

    if (!latestMsg) {
        console.log("NO INBOUND MESSAGES FOUND ON EPIC YET. SEND A TEST MESSAGE TO THE PHONE TO TRIGGER THE PIPELINE.");
        return;
    }

    console.log("\n=== LATEST REAL MESSAGE AUDIT ===");
    console.log(`Message ID: ${latestMsg.id}`);
    console.log(`Message Content: ${latestMsg.content}`);
    console.log(`Message Created At: ${latestMsg.created_at}`);

    // Try to grep the PM2 logs for this specific message ID to prove it entered the pipeline cleanly
    try {
        console.log("\n--- PM2 wa-api Logs for this Message ID ---");
        // We grep 500 lines around the message to see the identity flow
        const logs = execSync(`pm2 logs wa-api --lines 50000 --nostream | grep -C 5 "${latestMsg.id}"`).toString();
        console.log(logs);
        
        console.log("\n--- PM2 wa-api Logs for SESSION_B5743B (Checking for Stale Cache Leak) ---");
        try {
           const staleLogs = execSync(`pm2 logs wa-api --lines 1000 --nostream | grep "SESSION_B5743B"`).toString();
           console.log(staleLogs);
           console.log("Epic cache currently stale: DA (found in logs)");
        } catch(e) {
           console.log("No SESSION_B5743B occurrences found in recent logs.");
           console.log("Epic cache currently stale: NU");
        }
    } catch(e) {
        console.log("Could not grep PM2 logs. Message might have been processed before the current PM2 buffer, or log rotation occurred.");
    }

    // Trace down the database graph
    const convId = latestMsg.conversation_id;
    const { data: conv } = await supabase.from('conversations').select('*').eq('id', convId).single();
    
    if (conv) {
        console.log("\nconversation created/found: da");
        console.log(`Conversation ID: ${conv.id}`);
        console.log(`Client ID: ${conv.client_id}`);
        
        const { data: client } = await supabase.from('clients').select('*').eq('id', conv.client_id).single();
        console.log(`\nClient Resolved Brand Key: ${client.brand_key}`);
        console.log(`Client Public Alias: ${client.public_alias}`);
        
        if (client.brand_key === 'EPIC') {
            console.log("resolveClientIdentity used EPIC: da");
        } else {
             console.log("resolveClientIdentity used EPIC: nu");
        }
    } else {
        console.log("\nconversation created/found: nu");
    }

    // Check v_inbox_summaries
    const { data: inbox } = await supabase.from('v_inbox_summaries').select('*').eq('conversation_id', convId).single();
    if (inbox) {
         console.log("\nvisible in v_inbox_summaries: da");
         console.log(`final row text rendered in app (public_alias): ${inbox.public_alias}`);
         console.log(`last_message_content: ${inbox.last_message_content}`);
         console.log(`last_message_at: ${inbox.last_message_at}`);
         console.log(`session_label: ${inbox.session_label}`);
    } else {
         console.log("\nvisible in v_inbox_summaries: nu");
    }
    
    // Check if ANY client or link for this session resolves to the old brand
    const { count: badClients } = await supabase.from('clients').select('*', { count: 'exact', head: true }).in('id', [conv.client_id]).eq('brand_key', 'SESSION_B5743B');
    if (badClients > 0) {
        console.log("\nEpic still resolves under old brand SESSION_B5743B anywhere: da");
    } else {
        console.log("\nEpic still resolves under old brand SESSION_B5743B anywhere: nu");
    }
}

verifiedEpicTrace();
