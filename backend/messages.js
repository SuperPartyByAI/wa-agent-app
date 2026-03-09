const supabase = require('./supabase');

async function syncOutboundMessageToSupabase(phoneNumber, text, externalId, sessionId) {
  try {
    let clientId;
    const { data: existingClient } = await supabase.from('clients').select('id').eq('phone', phoneNumber).single();
    if (existingClient) {
      clientId = existingClient.id;
    } else {
      const { data: newClient } = await supabase.from('clients').insert({ full_name: 'WAC-' + phoneNumber, phone: phoneNumber, source: 'whatsapp' }).select().single();
      clientId = newClient?.id;
    }
    if (!clientId) return;

    let convId;
    const { data: existingConv } = await supabase.from('conversations').select('id').eq('client_id', clientId).eq('channel', 'whatsapp').single();
    if (existingConv) {
      convId = existingConv.id;
    } else {
      const { data: newConv } = await supabase.from('conversations').insert({ client_id: clientId, channel: 'whatsapp', status: 'open' }).select().single();
      convId = newConv?.id;
    }
    if (!convId) return;
    
    await supabase.from('conversations').update({ 
      session_id: sessionId,
      updated_at: new Date().toISOString()
    }).eq('id', convId);

    await supabase.from('messages').insert({
      conversation_id: convId,
      session_id: sessionId,
      direction: 'outbound',
      sender_type: 'agent',
      content: text,
      external_message_id: externalId || null,
      status: 'sent'
    });
  } catch(e) {
    console.error(`[Supabase Outbound Error] ${e.message}`);
  }
}

async function syncHistoricalMessageToSupabase(msg, sessionId) {
  try {
    if (!msg || !msg.key || !msg.key.remoteJid) return;
    if (msg.key.remoteJid === 'status@broadcast') return; // Ignore status updates

    const msgId = msg.key.id;
    const isOutbound = msg.key.fromMe;
    const numericPhone = msg.key.remoteJid.replace('@s.whatsapp.net', '').replace('@c.us', '');
    
    // Only parse exact personal numeric numbers
    if (numericPhone.includes('@g.us') || numericPhone.includes('-')) return; // Ignore groups for now (simplicity)

    const senderName = isOutbound ? "Me" : (msg.pushName || "WAC-" + numericPhone);
    const content = msg.message?.conversation || msg.message?.extendedTextMessage?.text || "";
    if (!content) return; // Skip media/empty payloads for the baseline audit
    
    // 1. Client
    let clientId;
    const { data: existingClient, error: getClientErr } = await supabase.from('clients').select('id').eq('phone', numericPhone).maybeSingle();
    
    if (existingClient) {
      clientId = existingClient.id;
    } else {
      const { data: newClient, error: clientErr } = await supabase.from('clients').insert({ full_name: senderName, phone: numericPhone, source: 'whatsapp' }).select().maybeSingle();
      if (clientErr) throw clientErr;
      clientId = newClient.id;
    }
    
    let convId;
    let currentUpdatedAt = 0;
    const { data: existingConv } = await supabase.from('conversations').select('id, updated_at').eq('client_id', clientId).eq('channel', 'whatsapp').maybeSingle();
    
    if (existingConv) {
      convId = existingConv.id;
      currentUpdatedAt = existingConv.updated_at ? new Date(existingConv.updated_at).getTime() : 0;
    } else {
      const { data: newConv, error: convErr } = await supabase.from('conversations').insert({ client_id: clientId, channel: 'whatsapp', status: 'open' }).select().maybeSingle();
      if (convErr) throw convErr;
      convId = newConv.id;
    }
    
    // 3. Message check
    const { data: existingMsg } = await supabase.from('messages').select('id').eq('external_message_id', msgId).maybeSingle();
    if (existingMsg) return; 

    let msgTime = Date.now();
    if (msg.messageTimestamp) {
        msgTime = typeof msg.messageTimestamp === 'number' ? msg.messageTimestamp * 1000 : msg.messageTimestamp.low * 1000;
    }

    const updatePayload = { session_id: sessionId };
    if (msgTime > currentUpdatedAt) {
        updatePayload.updated_at = new Date(msgTime).toISOString();
    }
    await supabase.from('conversations').update(updatePayload).eq('id', convId);

    // 4. Insert Message
    const { error: msgErr } = await supabase.from('messages').insert({
      conversation_id: convId,
      session_id: sessionId,
      direction: isOutbound ? 'outbound' : 'inbound',
      sender_type: isOutbound ? 'agent' : 'client',
      content: content,
      external_message_id: msgId,
      status: isOutbound ? 'sent' : 'delivered',
      created_at: new Date(msgTime).toISOString()
    });
    
    if (msgErr) throw msgErr;
  } catch (err) {
    if (err.code !== '23505') {
       console.error(`[Baileys Supabase History Sync Error] ${err.message || JSON.stringify(err)}`);
    }
  }
}

module.exports = {
  syncOutboundMessageToSupabase,
  syncHistoricalMessageToSupabase
};
