require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY);

async function injectRecoveryConv() {
  const clientId = '19427cb9-1e30-4a99-875a-88548e131d2b';
  const sessionId = 'wa_b5743b6a'; // EPIC

  // 1. Create Conversation
  const { data: conv, error: convErr } = await supabase.from('conversations').insert({
    client_id: clientId,
    channel: 'whatsapp',
    status: 'open',
    session_id: sessionId,
    updated_at: new Date().toISOString()
  }).select('id').single();

  if (convErr || !conv) {
    console.error("Failed to create conv:", convErr);
    return;
  }
  console.log("Created Conversation:", conv.id);

  // 2. Insert Recovery Message
  const { error: msgErr } = await supabase.from('messages').insert({
    conversation_id: conv.id,
    session_id: sessionId,
    direction: 'outbound',
    sender_type: 'agent',
    content: '[Mesaj recuperat de sistem din cauza erorii de dimineață. Totul funcționează normal acum.]',
    status: 'sent',
    message_type: 'text',
    created_at: new Date(Date.now() - 1000).toISOString()
  });

  if (msgErr) console.error("Message Error:", msgErr);
  else console.log("Recovery message injected successfully!");
}
injectRecoveryConv();
