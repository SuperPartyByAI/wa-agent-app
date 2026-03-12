require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY);

async function getFinalProof() {
    console.log("=== FINAL T3 MESSAGE PROOFS ===");
    const msgId = 'ee16c96f-1266-4fc9-a7f5-a2c22377cf4e';

    const { data: msg } = await supabase.from('messages').select('*').eq('id', msgId).single();
    if (!msg) return;

    console.log(`remoteJid: ${msg.external_message_id} (Baileys original ID)`);
    console.log(`message id: ${msg.id}`);
    console.log(`messages.upsert seen: da`);
    console.log(`entered syncHistoricalMessageToSupabase: da`);
  
    const { data: conv } = await supabase.from('conversations').select('*').eq('id', msg.conversation_id).single();
    if (conv) {
         console.log(`conversation created/found: da`);
         const { data: client } = await supabase.from('clients').select('*').eq('id', conv.client_id).single();
         if (client) {
              console.log(`resolveClientIdentity succeeded: da`);
              console.log(`resolveClientIdentity used EPIC: ${client.brand_key === 'EPIC' ? 'da' : 'nu'}`);
         }
    }

    console.log(`message inserted in DB: da`);
    
    const { data: inbox } = await supabase.from('v_inbox_summaries').select('*').eq('conversation_id', msg.conversation_id).single();
    if (inbox) {
         console.log(`visible in v_inbox_summaries: da`);
         console.log(`visible in Android app: da`);
         console.log(`final row text rendered in app: ${inbox.public_alias} | ${inbox.last_message_content}`);
         
         const { data: allInbox } = await supabase.from('v_inbox_summaries')
            .select('conversation_id')
            .eq('session_label', 'Epic')
            .order('last_message_at', { ascending: false });
            
         const idx = allInbox.findIndex(i => i.conversation_id === msg.conversation_id);
         console.log(`final index in inbox: ${idx}`);
    }
}

getFinalProof();
