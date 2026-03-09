const supabase = require('./supabase');
const { resolveClientIdentity } = require('./clientIdentity');

async function syncOutboundMessageToSupabase(phoneNumberOrIdentifier, text, externalId, sessionId, sock = null) {
  try {
    const client = await resolveClientIdentity(phoneNumberOrIdentifier, sessionId);
    if (!client) return;
    const clientId = client.id;

    if (sock && !client.avatar_url) {
      setTimeout(async () => {
         try {
           const remoteJid = phoneNumberOrIdentifier.includes('@lid') ? phoneNumberOrIdentifier : `${phoneNumberOrIdentifier.replace('+', '')}@s.whatsapp.net`;
           const ppUrl = await sock.profilePictureUrl(remoteJid, 'image').catch(() => null);
           if (ppUrl) await supabase.from('clients').update({ avatar_url: ppUrl }).eq('id', clientId);
         } catch(e) {}
      }, 0);
    }

    let convId;
    const { data: existingConv } = await supabase.from('conversations').select('id').eq('client_id', clientId).eq('channel', 'whatsapp').order('updated_at', { ascending: false }).limit(1).maybeSingle();
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

async function syncHistoricalMessageToSupabase(msg, sessionId, sock = null) {
  try {
    if (!msg || !msg.key || !msg.key.remoteJid) return;
    if (msg.key.remoteJid === 'status@broadcast') return; // Ignore status updates

    const msgId = msg.key.id;
    const isOutbound = msg.key.fromMe;
    const isLid = msg.key.remoteJid.includes('@lid');
    const remoteJid = msg.key.remoteJid;
    
    let numericPhone = null;
    let waIdentifier = null;
    
    if (isLid) waIdentifier = remoteJid;
    else numericPhone = remoteJid.replace('@s.whatsapp.net', '').replace('@c.us', '');
    
    const phoneOrWaIdentifier = isLid ? waIdentifier : numericPhone;
    if (!isLid && (numericPhone.includes('@g.us') || numericPhone.includes('-'))) return;

    const content = msg.message?.conversation || msg.message?.extendedTextMessage?.text || "";
    if (!content) return; // Skip media/empty payloads for the baseline audit
    
    // Resolve Identity natively through atomic locks (avoiding concurrent key collision limits)
    const client = await resolveClientIdentity(phoneOrWaIdentifier, sessionId);
    if (!client) return;
    const clientId = client.id;
    
    if (sock && !client.avatar_url) {
      setTimeout(async () => {
         try {
           const ppUrl = await sock.profilePictureUrl(remoteJid, 'image').catch(() => null);
           if (ppUrl) await supabase.from('clients').update({ avatar_url: ppUrl }).eq('id', clientId);
         } catch(e) {}
      }, 0);
    }
    
    let convId;
    let currentUpdatedAt = 0;
    const { data: existingConv } = await supabase.from('conversations').select('id, updated_at').eq('client_id', clientId).eq('channel', 'whatsapp').order('updated_at', { ascending: false }).limit(1).maybeSingle();
    
    if (existingConv) {
      convId = existingConv.id;
      currentUpdatedAt = existingConv.updated_at ? new Date(existingConv.updated_at).getTime() : 0;
    } else {
      const { data: newConv } = await supabase.from('conversations').insert({ client_id: clientId, channel: 'whatsapp', status: 'open' }).select().single();
      convId = newConv?.id;
    }
    if (!convId) return;

    const { data: existingMsg } = await supabase.from('messages').select('id').eq('external_message_id', msgId).limit(1).maybeSingle();
    if (!existingMsg) {
      const msgTimestamp = msg.messageTimestamp ? new Date(msg.messageTimestamp * 1000) : new Date();
      
      await supabase.from('messages').insert({
        conversation_id: convId,
        session_id: sessionId,
        direction: isOutbound ? 'outbound' : 'inbound',
        sender_type: isOutbound ? 'agent' : 'client',
        content: content,
        external_message_id: msgId,
        status: isOutbound ? 'sent' : 'received',
        created_at: msgTimestamp.toISOString()
      });

      if (msgTimestamp.getTime() > currentUpdatedAt) {
        await supabase.from('conversations').update({ 
          session_id: sessionId,
          updated_at: msgTimestamp.toISOString() 
        }).eq('id', convId);
      }
    }
    
  } catch(e) {
    console.error(`[Supabase Inbound Sync Error] ${e.message}`);
  }
}

module.exports = {
  syncOutboundMessageToSupabase,
  syncHistoricalMessageToSupabase
};
