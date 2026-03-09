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
    
    // 2. Conversation
    let convId;
    const { data: existingConv } = await supabase.from('conversations').select('id').eq('client_id', clientId).eq('channel', 'whatsapp').single();
    if (existingConv) {
      convId = existingConv.id;
    } else {
      const { data: newConv, error: convErr } = await supabase.from('conversations').insert({ client_id: clientId, channel: 'whatsapp', status: 'open' }).select().single();
      if (convErr) throw convErr;
      convId = newConv.id;
    }
    
    await supabase.from('conversations').update({ 
      session_id: sessionId, 
      updated_at: new Date(message.timestamp * 1000).toISOString() 
    }).eq('id', convId);
    
    // 3. Message
    const { error: msgErr } = await supabase.from('messages').insert({
      conversation_id: convId,
      session_id: sessionId,
      direction: 'inbound',
      sender_type: 'client',
      content: message.body || message.text || "",
      external_message_id: message.id
    });
      
    if (msgErr && msgErr.code !== '23505') throw msgErr; 

    // 4. (Auto-Draft Event) Basic keyword detection for Event creation
    const textLower = (message.body || message.text || "").toLowerCase();
    const eventKeywords = ['petrecere', 'zi de nastere', 'botez', 'eveniment', 'aniversare', 'petreceri copii'];
    
    if (eventKeywords.some(kw => textLower.includes(kw))) {
      const { data: existingEvent } = await supabase.from('events').select('id').eq('client_id', clientId).in('status', ['draft', 'pending_confirmation']).single();
      
      if (!existingEvent) {
        let eventType = 'birthday';
        if (textLower.includes('botez')) eventType = 'private_party';
        else if (textLower.includes('scoala') || textLower.includes('gradinita')) eventType = 'school';
        
        await supabase.from('events').insert({
          client_id: clientId,
          conversation_id: convId,
          title: `Nou Eveniment AI - Identificat din Mesaj`,
          event_type: eventType,
          status: 'draft',
          theme: 'Auto-detectat',
          special_requests: `Sursa auto-draft: "${textLower.substring(0, 80)}..."`
        });
        console.log(`[AI Agent] Auto-Drafted new Event for ${senderName}`);
      }
    }
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
    const isOutbound = message.fromMe;
    const phoneNumber = isOutbound ? message.to.replace('@c.us', '') : message.from.replace('@c.us', '');
    const senderName = isOutbound ? "Me" : (message.sender?.pushname || message.chat?.contact?.name || "WAC-" + phoneNumber);
    
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
    
    // 2. Conversation
    let convId;
    const { data: existingConv } = await supabase.from('conversations').select('id').eq('client_id', clientId).eq('channel', 'whatsapp').single();
    if (existingConv) {
      convId = existingConv.id;
    } else {
      const { data: newConv, error: convErr } = await supabase.from('conversations').insert({ client_id: clientId, channel: 'whatsapp', status: 'open', updated_at: new Date(message.timestamp * 1000).toISOString() }).select().single();
      if (convErr) throw convErr;
      convId = newConv.id;
    }
    
    await supabase.from('conversations').update({ 
      session_id: sessionId,
      updated_at: new Date(message.timestamp * 1000).toISOString()
    }).eq('id', convId);
    
    // 3. Message check for duplicates
    const { data: existingMsg } = await supabase.from('messages').select('id').eq('external_message_id', message.id).single();
    if (existingMsg) return; // Skip duplicate

    // 4. Insert Message
    await supabase.from('messages').insert({
      conversation_id: convId,
      session_id: sessionId,
      direction: isOutbound ? 'outbound' : 'inbound',
      sender_type: isOutbound ? 'agent' : 'client',
      content: message.body || message.text || "",
      external_message_id: message.id,
      status: isOutbound ? 'sent' : 'received',
      created_at: new Date(message.timestamp * 1000).toISOString()
    });
  } catch (err) {
    if (err.code !== '23505') {
       console.error(`[Supabase History Sync Error] ${err.message}`);
    }
  }
}

module.exports = {
  syncInboundMessageToSupabase,
  syncOutboundMessageToSupabase,
  syncHistoricalMessageToSupabase
};
