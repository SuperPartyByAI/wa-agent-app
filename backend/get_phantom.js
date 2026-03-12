require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY);

async function getRaw() {
    console.log("=== PHANTOM CLIENT AUDIT FOR T3 ===");
    const msgId = 'ee16c96f-1266-4fc9-a7f5-a2c22377cf4e';

    const { data: msg } = await supabase.from('messages').select('*').eq('id', msgId).single();
    
    console.log("RAW MSG ROW:");
    console.log(JSON.stringify(msg, null, 2));
    
    if (msg.client_id) {
         console.log(`\nSearching for Client ID: ${msg.client_id}`);
         const { data: client } = await supabase.from('clients').select('*').eq('id', msg.client_id).single();
         console.log("RAW CLIENT ROW:");
         console.log(JSON.stringify(client, null, 2));

         // What if it's the client ID from conversations instead?
         if (msg.conversation_id) {
              const { data: conv } = await supabase.from('conversations').select('*').eq('id', msg.conversation_id).single();
              console.log("\nRAW CONVERSATION ROW:");
              console.log(JSON.stringify(conv, null, 2));
              
              if (conv && conv.client_id !== msg.client_id) {
                   console.log(`\nMISMATCH! Msg Client: ${msg.client_id} vs Conv Client: ${conv.client_id}`);
                   const { data: convClient } = await supabase.from('clients').select('*').eq('id', conv.client_id).single();
                   console.log("CONV CLIENT ROW:");
                   console.log(JSON.stringify(convClient, null, 2));
              }
         }
    }
}

getRaw();
