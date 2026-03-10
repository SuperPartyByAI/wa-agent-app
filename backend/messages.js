const supabase = require('./supabase');
const { resolveClientIdentity } = require('./clientIdentity');

async function syncOutboundMessageToSupabase(phoneNumberOrIdentifier, text, externalId, sessionId, sock = null, bypassConvId = null) {
  try {
    const client = await resolveClientIdentity(phoneNumberOrIdentifier, sessionId);
    if (!client) return;
    let clientId = client.id;

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
    if (bypassConvId) {
      convId = bypassConvId;
    } else {
      // Route-Sticky Guard (Alias Drift Hardened): Lock onto any existing open conversation for the entire physical person graph.
      const { data: myLinks } = await supabase.from('client_identity_links').select('identifier_value').eq('client_id', clientId);
      const myIdentifiers = myLinks ? myLinks.map(l => l.identifier_value) : [];
      if (!myIdentifiers.includes(phoneNumberOrIdentifier)) myIdentifiers.push(phoneNumberOrIdentifier);

      const { data: aliasLinks } = await supabase.from('client_identity_links').select('client_id').in('identifier_value', myIdentifiers);
      if (aliasLinks && aliasLinks.length > 0) {
        const aliasIds = [...new Set(aliasLinks.map(l => l.client_id))];
        const { data: stickyConv } = await supabase.from('conversations')
          .select('id, client_id')
          .in('client_id', aliasIds)
          .eq('channel', 'whatsapp')
          .eq('session_id', sessionId)
          .eq('status', 'open')
          .order('updated_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (stickyConv) {
          console.log(`[Diagnostic] [Route-Sticky Guard] Unified outbound alias ${phoneNumberOrIdentifier} -> canonical conv ${stickyConv.id} (Client ${stickyConv.client_id}).`);
          convId = stickyConv.id;
          clientId = stickyConv.client_id;
        }
      }

      if (!convId) {
        const { data: newConv } = await supabase.from('conversations').insert({ client_id: clientId, channel: 'whatsapp', status: 'open', session_id: sessionId }).select().single();
        convId = newConv?.id;
      }
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
    if (!content) {
      console.log(`[Diagnostic] Skipping message ${msgId} due to empty content`, JSON.stringify(msg));
      return; // Skip media/empty payloads for the baseline audit
    }
    
    // Resolve Identity natively through atomic locks (avoiding concurrent key collision limits)
    const client = await resolveClientIdentity(phoneOrWaIdentifier, sessionId);
    if (!client) {
      console.log(`[Diagnostic] Skipping message ${msgId} due to missing client identity lock for ${phoneOrWaIdentifier}`);
      return;
    }
    let clientId = client.id;
    
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

    // Route-Sticky Guard (Alias Drift Hardened): Lock onto any existing open conversation for the entire physical person graph.
    const { data: myLinks } = await supabase.from('client_identity_links').select('identifier_value').eq('client_id', clientId);
    const myIdentifiers = myLinks ? myLinks.map(l => l.identifier_value) : [];
    if (!myIdentifiers.includes(phoneOrWaIdentifier)) myIdentifiers.push(phoneOrWaIdentifier);

    const { data: aliasLinks } = await supabase.from('client_identity_links').select('client_id').in('identifier_value', myIdentifiers);
    if (aliasLinks && aliasLinks.length > 0) {
      const aliasIds = [...new Set(aliasLinks.map(l => l.client_id))];
      const { data: stickyConv } = await supabase.from('conversations')
        .select('id, client_id, updated_at')
        .in('client_id', aliasIds)
        .eq('channel', 'whatsapp')
        .eq('session_id', sessionId)
        .eq('status', 'open')
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (stickyConv) {
        console.log(`[Diagnostic] [Route-Sticky Guard] Unified inbound drifted alias ${phoneOrWaIdentifier} -> canonical conv ${stickyConv.id} (Client ${stickyConv.client_id}).`);
        convId = stickyConv.id;
        clientId = stickyConv.client_id;
        currentUpdatedAt = stickyConv.updated_at ? new Date(stickyConv.updated_at).getTime() : 0;
      }
    }
    
    if (!convId) {
      const { data: newConv } = await supabase.from('conversations').insert({ client_id: clientId, channel: 'whatsapp', status: 'open', session_id: sessionId }).select().single();
      convId = newConv?.id;
    }
    if (!convId) {
      console.log(`[Diagnostic] Skipping message ${msgId} because conversation could not be created/found for client ${clientId}`);
      return;
    }

    const { data: existingMsg } = await supabase.from('messages').select('id').eq('external_message_id', msgId).limit(1).maybeSingle();
    console.log(`[Diagnostic] Attempting to insert msg ${msgId} (Exist: ${!!existingMsg}) to conv ${convId}`);
    if (!existingMsg) {
      const msgTimestamp = msg.messageTimestamp ? new Date(msg.messageTimestamp * 1000) : new Date();
      
      const { error: insertErr } = await supabase.from('messages').insert({
        conversation_id: convId,
        session_id: sessionId,
        direction: isOutbound ? 'outbound' : 'inbound',
        sender_type: isOutbound ? 'agent' : 'client',
        content: content,
        external_message_id: msgId,
        status: isOutbound ? 'sent' : 'delivered',
        created_at: msgTimestamp.toISOString()
      });
      if (insertErr) {
        console.error(`[Supabase Insert Fatal]`, JSON.stringify(insertErr));
      }

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
