const supabase = require('./supabase');
const { resolveClientIdentity } = require('./clientIdentity');
const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const crypto = require('crypto');

async function sendWebhookToManagerAi(payload, attempt = 1) {
  const maxRetries = 3;
  const webhookSecret = process.env.MANAGER_AI_WEBHOOK_SECRET || 'dev-secret-123';
  const url = process.env.MANAGER_AI_WEBHOOK_URL || 'http://91.98.16.90:3000/webhook/whts-up';
  
  const bodyString = JSON.stringify(payload);
  const signature = crypto.createHmac('sha256', webhookSecret).update(bodyString).digest('hex');
  
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000); // 5s timeout
    
    const response = await fetch(url, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'X-Hub-Signature': `sha256=${signature}`
      },
      body: bodyString,
      signal: controller.signal
    });
    
    clearTimeout(timeout);
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    console.log(`[Webhook AI Success] Msg: ${payload.message_id} to ${url}`);
  } catch (error) {
    if (attempt < maxRetries) {
      console.warn(`[Webhook AI Warn] Failed to send msg ${payload.message_id}, retrying ${attempt}/${maxRetries}... (${error.message})`);
      await new Promise(res => setTimeout(res, 1000 * attempt));
      await sendWebhookToManagerAi(payload, attempt + 1);
    } else {
      console.error(`[Webhook AI Fatal] Could not send msg ${payload.message_id} after ${maxRetries} attempts: ${error.message}`);
    }
  }
}

async function syncOutboundMessageToSupabase(phoneNumberOrIdentifier, text, externalId, sessionId, sock = null, bypassConvId = null, extraMeta = {}) {
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
      status: 'sent',
      ...extraMeta
    });

    // --- AI Webhook Sync ---
    sendWebhookToManagerAi({
      message_id: externalId,
      conversation_id: convId,
      content: text,
      sender_type: 'agent',
      timestamp: new Date().toISOString()
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

    let messageType = 'text';
    let messageSubtype = null;
    let caption = null;
    let mediaUrl = null;
    let storagePath = null;
    let mimeType = null;
    let fileName = null;
    let fileSize = null;
    let durationSeconds = null;
    let latitude = null;
    let longitude = null;
    let contactName = null;
    let contactVcard = null;
    let isPtt = false;

    let content = msg.message?.conversation || msg.message?.extendedTextMessage?.text || "";
    
    // Safety fallback for empty message objects from status broadcasts
    if (!msg.message) return;

    const messageKeys = Object.keys(msg.message);
    const isMedia = messageKeys.some(k => ['imageMessage', 'videoMessage', 'audioMessage', 'documentMessage'].includes(k));

    if (msg.message.imageMessage) {
        messageType = 'image';
        const imgMsg = msg.message.imageMessage;
        caption = imgMsg.caption || null;
        content = caption || "📷 Imagine";
        mimeType = imgMsg.mimetype;
        fileSize = imgMsg.fileLength ? Number(imgMsg.fileLength) : null;
    } else if (msg.message.videoMessage) {
        messageType = 'video';
        const vidMsg = msg.message.videoMessage;
        caption = vidMsg.caption || null;
        content = caption || "🎥 Video";
        mimeType = vidMsg.mimetype;
        fileSize = vidMsg.fileLength ? Number(vidMsg.fileLength) : null;
        durationSeconds = vidMsg.seconds;
        if (vidMsg.gifPlayback) messageSubtype = 'gif';
    } else if (msg.message.audioMessage) {
        messageType = 'audio';
        const audMsg = msg.message.audioMessage;
        content = audMsg.ptt ? "🎤 Mesaj Vocal" : "🎵 Audio";
        mimeType = audMsg.mimetype;
        fileSize = audMsg.fileLength ? Number(audMsg.fileLength) : null;
        durationSeconds = audMsg.seconds;
        isPtt = !!audMsg.ptt;
    } else if (msg.message.documentMessage) {
        messageType = 'document';
        const docMsg = msg.message.documentMessage;
        caption = docMsg.caption || null;
        fileName = docMsg.fileName;
        content = caption || fileName || "📄 Document";
        mimeType = docMsg.mimetype;
        fileSize = docMsg.fileLength ? Number(docMsg.fileLength) : null;
    } else if (msg.message.locationMessage) {
        messageType = 'location';
        const locMsg = msg.message.locationMessage;
        latitude = locMsg.degreesLatitude;
        longitude = locMsg.degreesLongitude;
        content = locMsg.name ? `📍 ${locMsg.name}` : `📍 Locație (${latitude}, ${longitude})`;
    } else if (msg.message.contactMessage) {
        messageType = 'contact';
        const ctMsg = msg.message.contactMessage;
        contactName = ctMsg.displayName;
        contactVcard = ctMsg.vcard;
        content = `👤 Contact: ${contactName || 'Necunoscut'}`;
    }

    if (!content && messageType === 'text') {
      console.log(`[Diagnostic] Skipping message ${msgId} due to empty content or unknown payload.`, JSON.stringify(msg));
      return; 
    }

    if (isMedia && sock) {
        try {
            const buffer = await downloadMediaMessage(msg, 'buffer', {}, { logger: require('pino')({ level: 'silent' }) });
            if (buffer) {
                const extMap = {
                    'image/jpeg': '.jpg', 'image/png': '.png', 'video/mp4': '.mp4',
                    'audio/ogg; codecs=opus': '.ogg', 'audio/mp4': '.m4a', 'application/pdf': '.pdf'
                };
                let ext = extMap[mimeType] || '';
                if (!ext && fileName && fileName.includes('.')) ext = '.' + fileName.split('.').pop();
                
                storagePath = `inbound/${sessionId}/${msgId}${ext}`;
                const { error: uploadErr } = await supabase.storage.from('whatsapp_media').upload(storagePath, buffer, {
                    contentType: mimeType || 'application/octet-stream',
                    upsert: true
                });

                if (uploadErr) {
                    console.error(`[Media Upload Error] ${msgId}:`, uploadErr);
                    storagePath = null;
                } else {
                    mediaUrl = supabase.storage.from('whatsapp_media').getPublicUrl(storagePath).data.publicUrl;
                }
            }
        } catch (mediaErr) {
            console.error(`[Media Download Exception] MsgId: ${msgId}`, mediaErr.message);
        }
    }
    
    // Resolve Identity natively through atomic locks (avoiding concurrent key collision limits)
    console.log(`[PII DEBUG] Incoming Msg Key Dump for ${msgId}:`, JSON.stringify(msg.key, null, 2));
    const altIdentifier = msg.key.remoteJidAlt || null;
    console.log(`[PII DEBUG] Decoded remoteJid: ${phoneOrWaIdentifier} | remoteJidAlt: ${altIdentifier}`);

    const client = await resolveClientIdentity(phoneOrWaIdentifier, sessionId, altIdentifier);
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
        created_at: msgTimestamp.toISOString(),
        message_type: messageType,
        media_url: mediaUrl,
        mime_type: mimeType,
        file_name: fileName,
        file_size: fileSize,
        duration_seconds: durationSeconds,
        latitude: latitude,
        longitude: longitude,
        contact_name: contactName,
        contact_vcard: contactVcard
      });
      if (insertErr) {
        console.error(`[Supabase Insert Fatal]`, JSON.stringify(insertErr));
      } else {
        // --- AI Webhook Sync ---
        sendWebhookToManagerAi({
          message_id: msgId,
          conversation_id: convId,
          content,
          sender_type: isOutbound ? 'agent' : 'client',
          timestamp: new Date().toISOString()
        });
      }

      if (msgTimestamp.getTime() > currentUpdatedAt) {
        await supabase.from('conversations').update({ 
          session_id: sessionId,
          updated_at: msgTimestamp.toISOString() 
        }).eq('id', convId);
      }
      
      if (messageType === 'contact' && contactVcard) {
        require('./pii').updateClientRealPhoneGraph(clientId).catch(e => console.error('[Auto-PII Vcard Error]', e.message));
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
