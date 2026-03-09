const supabase = require('./supabase');

async function syncInboundMessageToSupabase(message, sessionId) {
  try {
    const phoneNumber = message.from.replace('@c.us', '');
    const senderName = message.sender?.pushname || "WAC-" + phoneNumber;
    
    // 1. Client
    let clientId;
    const { data: existingClient } = await supabase.from('clients').select('id').eq('phone', phoneNumber).single();
    if (existingClient) {
      clientId = existingClient.id;
    } else {
      const { data: newClient, error: clientErr } = await supabase.from('clients').insert({ full_name: senderName, phone: phoneNumber, source: 'whatsapp' }).select().single();
      if (clientErr) throw clientErr;
      clientId = newClient.id;
    }
    
    let convId;
    const { data: existingConv } = await supabase.from('conversations').select('id').eq('client_id', clientId).eq('channel', 'whatsapp').single();
    if (existingConv) {
      convId = existingConv.id;
    } else {
      const { data: newConv, error: convErr } = await supabase.from('conversations').insert({ client_id: clientId, channel: 'whatsapp', status: 'open' }).select().single();
      if (convErr) throw convErr;
      convId = newConv.id;
    }
    
    // 3. Prevent Inbox hijacking by checking for duplicate webhooks FIRST
    const { data: existingMsg } = await supabase.from('messages').select('id').eq('external_message_id', message.id).maybeSingle();
    if (existingMsg) return; 
    
    await supabase.from('conversations').update({ 
      session_id: sessionId, 
      updated_at: new Date(message.timestamp * 1000).toISOString() 
    }).eq('id', convId);
    
    // 4. Insert Message
    const { error: msgErr } = await supabase.from('messages').insert({
      conversation_id: convId,
      session_id: sessionId,
      direction: 'inbound',
      sender_type: 'client',
      content: message.body || message.text || "",
      external_message_id: message.id
    });
      
  } catch (err) {
    console.error(`[Supabase Inbound Error] ${err.message}`);
  }
}

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

async function syncHistoricalMessageToSupabase(message, sessionId) {
  try {
    if (!message || !message.id) return;
    const msgId = typeof message.id === 'object' ? (message.id._serialized || JSON.stringify(message.id)) : message.id;
    
    console.log(`[SYNC-TRACE] Found message: ${msgId} | fromMe: ${message.fromMe}`);
    
    const isOutbound = message.fromMe;
    const phoneNumber = isOutbound ? message.to.replace('@c.us', '') : message.from.replace('@c.us', '');
    const senderName = isOutbound ? "Me" : (message.sender?.pushname || message.chat?.contact?.name || "WAC-" + phoneNumber);
    
    // 1. Client
    let clientId;
    const { data: existingClient, error: getClientErr } = await supabase.from('clients').select('id').eq('phone', phoneNumber).maybeSingle();
    if (getClientErr) console.error(`[SYNC-TRACE] Client Get Error: ${JSON.stringify(getClientErr)}`);
    
    if (existingClient) {
      clientId = existingClient.id;
    } else {
      const { data: newClient, error: clientErr } = await supabase.from('clients').insert({ full_name: senderName, phone: phoneNumber, source: 'whatsapp' }).select().maybeSingle();
      if (clientErr) throw clientErr;
      clientId = newClient.id;
    }
    
    let convId;
    let currentUpdatedAt = 0;
    const { data: existingConv, error: getConvErr } = await supabase.from('conversations').select('id, updated_at').eq('client_id', clientId).eq('channel', 'whatsapp').maybeSingle();
    if (getConvErr) console.error(`[SYNC-TRACE] Conv Get Error: ${JSON.stringify(getConvErr)}`);
    
    if (existingConv) {
      convId = existingConv.id;
      currentUpdatedAt = existingConv.updated_at ? new Date(existingConv.updated_at).getTime() : 0;
    } else {
      const { data: newConv, error: convErr } = await supabase.from('conversations').insert({ client_id: clientId, channel: 'whatsapp', status: 'open', updated_at: new Date(message.timestamp * 1000).toISOString() }).select().maybeSingle();
      if (convErr) throw convErr;
      convId = newConv.id;
      currentUpdatedAt = new Date(message.timestamp * 1000).getTime();
    }
    
    // 3. Message check
    const { data: existingMsg, error: getMsgErr } = await supabase.from('messages').select('id').eq('external_message_id', msgId).maybeSingle();
    if (getMsgErr) console.error(`[SYNC-TRACE] Msg Get Error: ${JSON.stringify(getMsgErr)}`);
    if (existingMsg) {
       console.log(`[SYNC-TRACE] Duplicate Message Skipped: ${msgId}`);
       return; 
    }

    const msgTime = message.timestamp * 1000;
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
      content: message.body || message.text || "",
      external_message_id: msgId,
      status: isOutbound ? 'sent' : 'received',
      created_at: new Date(msgTime).toISOString()
    });
    
    if (msgErr) throw msgErr;
    console.log(`[SYNC-TRACE] SUCCESS INSERT: ${msgId}`);
  } catch (err) {
    if (err.code !== '23505') {
       console.error(`[Supabase History Sync Error] ${err.message || JSON.stringify(err)}`);
    } else {
       console.log(`[SYNC-TRACE] Expected silent unique collision avoided.`);
    }
  }
}

module.exports = {
  syncInboundMessageToSupabase,
  syncOutboundMessageToSupabase,
  syncHistoricalMessageToSupabase
};
