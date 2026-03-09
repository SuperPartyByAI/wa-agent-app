const supabase = require('./supabase');
const crypto = require('crypto');

const sessionLabelCache = {};
async function getBrandInfo(sessionId) {
   if (sessionLabelCache[sessionId]) return sessionLabelCache[sessionId];
   const { data } = await supabase.from('whatsapp_sessions').select('label').eq('session_key', sessionId).limit(1).maybeSingle();
   const label = (data && data.label) ? data.label : 'Agent';
   const key = label.trim().toUpperCase().replace(/\s+/g, '_');
   sessionLabelCache[sessionId] = { label, key };
   return sessionLabelCache[sessionId];
}

async function syncOutboundMessageToSupabase(phoneNumberOrIdentifier, text, externalId, sessionId, sock = null) {
  try {
    let clientId;
    let isLid = phoneNumberOrIdentifier.includes('@lid') || phoneNumberOrIdentifier.includes('@g.us');
    
    const brandInfo = await getBrandInfo(sessionId);

    let existingClient;
    if (isLid) {
       const resp = await supabase.from('clients').select('id, avatar_url, public_alias').eq('wa_identifier', phoneNumberOrIdentifier).eq('brand_key', brandInfo.key).order('created_at', { ascending: false }).limit(1).maybeSingle();
       existingClient = resp.data;
    } else {
       const resp = await supabase.from('clients').select('id, avatar_url, public_alias').eq('phone', phoneNumberOrIdentifier).eq('brand_key', brandInfo.key).order('created_at', { ascending: false }).limit(1).maybeSingle();
       existingClient = resp.data;
    }

    if (existingClient) {
      clientId = existingClient.id;
    } else {
      const { data: nextIdxData } = await supabase.rpc('get_next_brand_alias_index', { p_brand_key: brandInfo.key });
      let nextIdx = nextIdxData !== null ? nextIdxData : 1;
      const internalCode = `CL-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
      const publicAlias = `${brandInfo.label}-${nextIdx.toString().padStart(2, '0')}`;

      const insertPayload = { 
        full_name: publicAlias, 
        source: 'whatsapp',
        brand_key: brandInfo.key,
        public_alias: publicAlias,
        internal_client_code: internalCode,
        alias_index: nextIdx
      };
      if (isLid) insertPayload.wa_identifier = phoneNumberOrIdentifier;
      else insertPayload.phone = phoneNumberOrIdentifier;
      
      const { data: newClient } = await supabase.from('clients').insert(insertPayload).select().single();
      if (newClient) clientId = newClient.id;
    }
    if (!clientId) return;

    if (sock && (!existingClient || !existingClient.avatar_url)) {
      setTimeout(async () => {
         try {
           const remoteJid = isLid ? phoneNumberOrIdentifier : `${phoneNumberOrIdentifier.replace('+', '')}@s.whatsapp.net`;
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
    
    let numericPhone = null;
    let waIdentifier = null;
    
    if (isLid) {
       waIdentifier = msg.key.remoteJid;
    } else {
       numericPhone = msg.key.remoteJid.replace('@s.whatsapp.net', '').replace('@c.us', '');
    }
    
    // Only parse exact personal numeric numbers or LIDs
    if (!isLid && (numericPhone.includes('@g.us') || numericPhone.includes('-'))) return; // Ignore groups for now (simplicity)

    const content = msg.message?.conversation || msg.message?.extendedTextMessage?.text || "";
    if (!content) return; // Skip media/empty payloads for the baseline audit
    
    const brandInfo = await getBrandInfo(sessionId);

    // 1. Client
    let clientId;
    let existingClient;
    
    if (isLid) {
       const resp = await supabase.from('clients').select('id, avatar_url, public_alias').eq('wa_identifier', waIdentifier).eq('brand_key', brandInfo.key).order('created_at', { ascending: false }).limit(1).maybeSingle();
       existingClient = resp.data;
    } else {
       const resp = await supabase.from('clients').select('id, avatar_url, public_alias').eq('phone', numericPhone).eq('brand_key', brandInfo.key).order('created_at', { ascending: false }).limit(1).maybeSingle();
       existingClient = resp.data;
    }
    
    if (existingClient) {
      clientId = existingClient.id;
    } else {
      const { data: nextIdxData } = await supabase.rpc('get_next_brand_alias_index', { p_brand_key: brandInfo.key });
      let nextIdx = nextIdxData !== null ? nextIdxData : 1;
      const internalCode = `CL-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
      const publicAlias = `${brandInfo.label}-${nextIdx.toString().padStart(2, '0')}`;

      const senderName = isOutbound ? "Me" : (msg.pushName || publicAlias);

      const insertPayload = { 
        full_name: senderName, 
        source: 'whatsapp',
        brand_key: brandInfo.key,
        public_alias: publicAlias,
        internal_client_code: internalCode,
        alias_index: nextIdx
      };
      if (isLid) insertPayload.wa_identifier = waIdentifier;
      if (numericPhone) insertPayload.phone = numericPhone;
      
      const { data: newClient, error: clientErr } = await supabase.from('clients').insert(insertPayload).select().maybeSingle();
      if (clientErr) throw clientErr;
      if (newClient) clientId = newClient.id;
    }
    
    if (!clientId) return;

    if (sock && (!existingClient || !existingClient.avatar_url)) {
      setTimeout(async () => {
         try {
           const remoteJid = isLid ? waIdentifier : `${numericPhone}@s.whatsapp.net`;
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

    // 3. Message check
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

      // 4. Update conversation timestamp
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
