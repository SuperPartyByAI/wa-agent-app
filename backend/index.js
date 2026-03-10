require("dotenv").config();
const express = require("express");
const cors = require("cors");
const fs = require('fs');

const supabase = require('./supabase');
const { syncOutboundMessageToSupabase } = require('./messages');
const { sessions, startSession, upsertSessionStatus, logger } = require('./sessions');

async function sync3cxCallEvent(event, number, extension) {
  try {
    const formattedNumber = number.startsWith('+') ? number : '+' + number;
    
    // Leverage the new Atomic RPC to gracefully handle Zero-Trust Identity creation / linking
    const rpcPayload = {
      p_brand_key: 'system',
      p_identifiers: [{ type: 'msisdn', value: formattedNumber }],
      p_source: 'call',
      p_alias_prefix: 'CALL'
    };
    
    const { data: clientData, error } = await supabase.rpc('create_client_identity_safe', rpcPayload);
    if (error) {
      throw new Error(`Supabase RPC Error: ${error.message}`);
    }

    let clientId = null;
    if (clientData) {
      clientId = Array.isArray(clientData) ? clientData[0].id : clientData.id;
    } else {
      throw new Error("No client data returned from create_client_identity_safe");
    }
    
    let callStatus = 'completed';
    if (event === 'call_incoming') callStatus = 'ringing';
    else if (event === 'call_missed') callStatus = 'missed';

    await supabase.from('call_events').insert({
      client_id: clientId,
      direction: 'inbound', 
      status: callStatus,
      from_number: number,
      extension: extension,
      started_at: new Date().toISOString()
    });
  } catch(e) {
    console.error(`[Supabase 3CX Sync Error] ${e.message}`);
  }
}

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.API_KEY || "SECRET_TOKEN_CHANGE_ME";

const requireApiKey = (req, res, next) => {
  const key = req.headers["x-api-key"] || req.query.api_key;
  if (key !== API_KEY) {
    return res.status(401).json({ error: "Unauthorized: Invalid API Key" });
  }
  next();
};

app.post("/api/sessions/start", requireApiKey, async (req, res) => {
  const { sessionId } = req.body;
  if (!sessionId)
    return res.status(400).json({ error: "sessionId is required" });

  startSession(sessionId);
  res.json({ message: `Session ${sessionId} initialization started.` });
});

app.get("/api/sessions/status/:sessionId?", requireApiKey, (req, res) => {
  const { sessionId } = req.params;

  if (sessionId) {
    const session = sessions.get(sessionId);
    if (!session) return res.status(404).json({ error: "Session not found" });
    return res.json({
      sessionId: sessionId,
      status: session.status,
      qrCode: session.status === "AWAITING_QR" ? session.qrCode : null,
    });
  }

  const all = Array.from(sessions.entries()).map(([id, data]) => ({
    sessionId: id,
    status: data.status,
  }));
  res.json({ sessions: all });
});

app.post("/api/sessions/logout", requireApiKey, async (req, res) => {
  const { sessionId } = req.body;
  if (!sessionId) return res.status(400).json({ error: "sessionId is required" });
  const session = sessions.get(sessionId);
  if (session && session.client) {
    try { await session.client.logout(); } catch(e) {}
    try { session.client.end(undefined); } catch(e) {}
  }
  sessions.delete(sessionId);
  await upsertSessionStatus(sessionId, 'DISCONNECTED');
  return res.json({ message: "Logged out successfully" });
});

app.post("/api/sessions/reconnect", requireApiKey, async (req, res) => {
  const { sessionId } = req.body;
  if (!sessionId) return res.status(400).json({ error: "sessionId is required" });
  startSession(sessionId);
  res.json({ message: `Session ${sessionId} reconnection started.` });
});

app.delete("/api/sessions/:sessionId", requireApiKey, async (req, res) => {
  const { sessionId } = req.params;
  const session = sessions.get(sessionId);
  if (session && session.client) {
    try { session.client.end(undefined); } catch(e) {}
  }
  sessions.delete(sessionId);
  await upsertSessionStatus(sessionId, 'DISCONNECTED');
  res.json({ message: `Session ${sessionId} killed and removed.` });
});

app.post("/api/messages/send", requireApiKey, async (req, res) => {
  let { 
    sessionId: requestedSessionId, 
    text, 
    conversationId,
    message_type = 'text',
    media_url,
    mime_type,
    file_name,
    latitude,
    longitude,
    contact_name,
    contact_vcard,
    is_ptt
  } = req.body;

  if (!requestedSessionId || !conversationId) {
    return res.status(400).json({ error: "Missing sessionId or conversationId" });
  }
  if (message_type === 'text' && !text) {
    return res.status(400).json({ error: "Missing text for text message" });
  }

  // Organic identity derived securely avoiding UI leaks
  const { data: convData } = await supabase.from('conversations').select('client_id, session_id').eq('id', conversationId).single();
  if (!convData) return res.status(404).json({ error: "Conversation not found" });

  const { data: links } = await supabase.from('client_identity_links')
    .select('identifier_type, identifier_value')
    .eq('client_id', convData.client_id);
    
  if (!links || links.length === 0) return res.status(400).json({ error: "No physical identifiers bound to this client" });

  // Prioritize native JID or LID formats for WhatsApp delivery before falling back to MSISDN interpolation
  const jid = links.find(l => ['jid', 'lid', 'group_jid'].includes(l.identifier_type));
  const msisdn = links.find(l => l.identifier_type === 'msisdn');
  let to = jid ? jid.identifier_value : msisdn?.identifier_value;
  let isLid = String(to).includes('@lid') || String(to).includes('@g.us');

  if (!isLid) {
    to = String(to).replace(/[^0-9+]/g, '');
    const phoneRegex = /^\+?\d+$/;
    if (!phoneRegex.test(to)) {
      return res.status(400).json({ error: "Native client routing format corrupted." });
    }
  }

  // STRICT ROUTING ENFORCEMENT: The conversation's route unconditionally dictates the outbound session!
  // We override the Android UI's requested string to prevent cross-routing bugs.
  let activeSessionId = convData.session_id || requestedSessionId;
  let activeSession = sessions.get(activeSessionId);
  let fallbackUsed = false;

  if (!activeSession || activeSession.status !== "CONNECTED" || !activeSession.client) {
    logger(requestedSessionId, "warn", `Requested session is disconnected or missing. Initiating smart-routing via Supabase CRM...`);
    try {
      const { data: staleData } = await supabase.from('whatsapp_sessions').select('phone_number').eq('session_key', requestedSessionId).single();
      
      if (staleData && staleData.phone_number) {
        const { data: replacementData } = await supabase.from('whatsapp_sessions')
          .select('session_key')
          .eq('phone_number', staleData.phone_number)
          .eq('status', 'CONNECTED')
          .order('updated_at', { ascending: false })
          .limit(1)
          .single();
          
        if (replacementData && replacementData.session_key) {
          const replacementId = replacementData.session_key;
          const runtimeTarget = sessions.get(replacementId);
          if (runtimeTarget && runtimeTarget.status === "CONNECTED" && runtimeTarget.client) {
            activeSessionId = replacementId;
            activeSession = runtimeTarget;
            fallbackUsed = true;
            logger(activeSessionId, "warn", `Smart-Routed: Mapped stale session ${requestedSessionId} to active socket ${activeSessionId} via matching phone ${staleData.phone_number}`);
          }
        }
      }
    } catch (routeErr) {
      logger(requestedSessionId, "error", `Smart-routing Supabase lookup failed: ${routeErr.message}`);
    }

    if (!activeSession || activeSession.status !== "CONNECTED" || !activeSession.client) {
      return res.status(400).json({ error: "Session is not connected, and no matching CRM active session was found." });
    }
  }

  const formattedRoute = isLid ? to : to.replace('+', '');
  const targetJid = isLid ? to : `${formattedRoute}@s.whatsapp.net`;
  
  try {
    let success = false;
    let lastError = null;
    let result = null;

    let baileysPayload = {};
    const contentStr = text || "";

    if (message_type === 'text') {
        baileysPayload = { text: contentStr };
    } else if (message_type === 'image') {
        baileysPayload = { image: { url: media_url }, caption: contentStr };
    } else if (message_type === 'video') {
        baileysPayload = { video: { url: media_url }, caption: contentStr };
    } else if (message_type === 'audio') {
        baileysPayload = { audio: { url: media_url }, mimetype: mime_type || 'audio/mp4', ptt: !!is_ptt };
    } else if (message_type === 'document') {
        baileysPayload = { document: { url: media_url }, mimetype: mime_type || 'application/octet-stream', fileName: file_name || 'document', caption: contentStr };
    } else if (message_type === 'location') {
        baileysPayload = { location: { degreesLatitude: parseFloat(latitude), degreesLongitude: parseFloat(longitude), name: contentStr } };
    } else if (message_type === 'contact') {
        baileysPayload = { contacts: { displayName: contact_name, contacts: [{ vcard: contact_vcard }] } };
    }

    for (let i = 0; i < 3; i++) {
        try {
            // Baileys structure
            result = await activeSession.client.sendMessage(targetJid, baileysPayload);
            success = true;
            break;
        } catch (err) {
            lastError = err;
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
    }

    if (!success) {
      logger(activeSessionId, "error", `Sending failed after retries to ${formattedRoute}. Error: ${lastError?.message || lastError}`);
      return res.status(500).json({ error: "Failed to send message after retries.", details: lastError?.message || String(lastError) });
    }

    // Explicit format mapping for external message ID resolution in Baileys
    const externalId = result?.key?.id || null;
    const extraMeta = {
      message_type,
      media_url: media_url || null,
      mime_type: mime_type || null,
      file_name: file_name || null,
      latitude: latitude ? parseFloat(latitude) : null,
      longitude: longitude ? parseFloat(longitude) : null,
      contact_name: contact_name || null,
      contact_vcard: contact_vcard || null
    };

    syncOutboundMessageToSupabase(formattedRoute, contentStr, externalId, activeSessionId, activeSession.client, conversationId, extraMeta).catch(e => {
        logger(activeSessionId, "error", `Failed to sync outbound message to Supabase: ${e.message}`);
    });

    res.json({
        success: true,
        message: "Message sent successfully.",
        resolvedSessionId: activeSessionId,
        fallbackUsed: fallbackUsed
    });
  } catch (err) {
    logger(activeSessionId, "error", `General error sending message to ${formattedRoute}: ${err.message}`);
    res.status(500).json({ error: "Failed to send message.", details: err.message });
  }
});

app.post("/api/sessions/rename", requireApiKey, async (req, res) => {
  const { sessionId, newLabel } = req.body;
  if (!sessionId) return res.status(400).json({ error: "sessionId is required" });
  try {
    const { error } = await supabase.from("whatsapp_sessions")
      .update({ label: newLabel, updated_at: new Date().toISOString() })
      .eq("session_key", sessionId);
    if (error) throw error;
    
    // Invalidate the RAM mapping so the new Label (e.g., "Divertix") applies to all future inbound generated clients
    try {
      const { sessionBrandCache } = require('./clientIdentity');
      sessionBrandCache.delete(sessionId);
    } catch(e) {
      console.error("[SessionRename] Failed to bust session memory cache:", e);
    }

    res.json({ success: true, message: "Session renamed successfully." });
  } catch (err) {
    logger(sessionId, "error", `Failed to rename session: ${err.message}`);
    res.status(500).json({ error: "Database error", details: err.message });
  }
});

app.post("/api/clients/rename", requireApiKey, async (req, res) => {
  const { conversationId, newAlias } = req.body;
  if (!conversationId || !newAlias) return res.status(400).json({ error: "conversationId and newAlias are required" });
  try {
    const { data: conv } = await supabase.from("conversations").select("client_id").eq("id", conversationId).single();
    if (!conv || !conv.client_id) return res.status(404).json({ error: "Conversation or client not found." });
    
    const { error } = await supabase.from("clients")
      .update({ public_alias: newAlias, updated_at: new Date().toISOString() })
      .eq("id", conv.client_id);
    if (error) throw error;
    res.json({ success: true, message: "Client alias updated successfully." });
  } catch (err) {
    res.status(500).json({ error: "Database error", details: err.message });
  }
});

app.post("/3cx/event", requireApiKey, async (req, res) => {
  const { event, number, extension, timestamp, sessionId } = req.body;
  
  console.log(`[3CX] Received event: ${event} for number: ${number}`);
  
  // 1. ALWAYS LOG TO CRM FIRST (Decoupled from WhatsApp state)
  let crmLogged = false;
  let crmError = null;
  try {
    // Await this fully so we don't return 200 OK if the DB fails
    await sync3cxCallEvent(event, number, extension);
    crmLogged = true;
    console.log(`[3CX] CRM Call Journaling successful for ${number}`);
  } catch (err) {
    console.error(`[3CX CRM Logging Fatal Error] ${err.message}`);
    crmError = err.message;
  }

  // 2. ATTEMPT WHATSAPP SIDE-EFFECT
  let targetSessionId = sessionId;
  
  if (!targetSessionId) {
    const formattedNumber = number.replace('+', '');
    let convId = null;
    let sourceSession = null;

    // Fallback: If absolutely no context is found, try to locate any historic Conversation by Phone
    if (!convId) {
      const { data: linkData } = await supabase.from('client_identity_links')
          .select('client_id')
          .eq('identifier_value', formattedNumber)
          .limit(1)
          .maybeSingle();
          
      if (linkData) {
        const { data: convMatch } = await supabase.from('conversations').select('id, session_id').eq('client_id', linkData.client_id).order('updated_at', { ascending: false }).limit(1).maybeSingle();
        if (convMatch) {
          convId = convMatch.id;
          sourceSession = convMatch.session_id;
        }
      }
    }
    if (sourceSession) targetSessionId = sourceSession;
  }

  let targetSession = null;
  if (targetSessionId && sessions.has(targetSessionId)) {
    targetSession = sessions.get(targetSessionId);
  }

  let waSideEffectStatus = "skipped";
  let waError = null;

  if (!targetSession || targetSession.status !== "CONNECTED" || !targetSession.client) {
    waSideEffectStatus = "skipped_offline";
    waError = "Strict Routing: No explicit connected WhatsApp session found running in memory.";
    console.warn(`[3CX WA Hook] Skipped WhatsApp outbound side-effect for ${number}: ${waError}`);
  } else {
    try {
      if (event === "call_incoming") {
        const message = `[Sistem] Apel de intrare pe extensia ${extension} de la ${number}.`;
        const formattedNumber = number.replace('+', '');
        // Baileys structure
        const result = await targetSession.client.sendMessage(`${formattedNumber}@s.whatsapp.net`, { text: message });
        console.log(`[3CX Action] Sent WA side-effect message to ${formattedNumber}`);
        
        const externalId = result?.key?.id || null;
        await syncOutboundMessageToSupabase(formattedNumber, message, externalId, targetSessionId, targetSession.client).catch(e => {
          console.error(`[3CX Sync Error] Failed to sync outbound message to Supabase: ${e.message}`);
        });
        waSideEffectStatus = "sent";
      }
    } catch (err) {
      console.error(`[3CX WA Runtime Error] ${err.message}`);
      waSideEffectStatus = "failed";
      waError = err.message;
    }
  }

  const statusCode = crmLogged ? 200 : 500;
  return res.status(statusCode).json({
    success: crmLogged,
    message: crmLogged ? "Event processed successfully." : "Fatal Error logging call event to CRM.",
    details: {
      crm_logged: crmLogged,
      crm_error: crmError,
      wa_side_effect: waSideEffectStatus,
      wa_error: waError
    }
  });
});

app.get("/api/clients/:clientId/real-number", async (req, res) => {
  const { clientId } = req.params;
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: "Unauthorized. Missing Bearer JWT." });
  }

  const token = authHeader.replace('Bearer ', '');
  console.log(`[PII Resolver] Incoming request to resolve real number for client ${clientId}`);
  
  // 1. Authenticate user explicitly via Supabase Auth
  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user) {
    console.log(`[PII Resolver] Auth Failed for client ${clientId}: ${authErr ? authErr.message : 'No User'}`);
    return res.status(401).json({ error: "Unauthorized. Invalid JWT Token." });
  }

  // 2. Gate admin specifically
  if (user.email !== 'ursache.andrei1995@gmail.com') {
    return res.status(403).json({ error: "Access Denied. Nu ai drepturi de administrator pentru a prelua PII (Număr fizic real)." });
  }

  try {
    // Check canonical property first 
    const { data: clientData, error: clientErr } = await supabase
      .from('clients')
      .select('real_phone_e164')
      .eq('id', clientId)
      .single();

    if (clientData && clientData.real_phone_e164) {
       console.log(`[PII Resolver] Success. Found canonical real hit for ${clientId}: ${clientData.real_phone_e164}`);
       return res.json({ realNumber: clientData.real_phone_e164 });
    }

    // Force recalculate if null
    console.log(`[PII Resolver] No canonical property for ${clientId}. Recalculating graph...`);
    const { updateClientRealPhoneGraph } = require('./pii');
    await updateClientRealPhoneGraph(clientId);
    
    // Check again
    const { data: clientRefreshed } = await supabase
      .from('clients')
      .select('real_phone_e164')
      .eq('id', clientId)
      .single();

    if (clientRefreshed && clientRefreshed.real_phone_e164) {
       return res.json({ realNumber: clientRefreshed.real_phone_e164 });
    }

    // If absolutely no graph matched
    return res.status(404).json({ error: 'Număr real indisponibil' });
  } catch(e) {
    console.error(`[PII Resolver] Error: ${e.message}`);
    return res.status(500).json({ error: 'Internal Server Error fetching PII' });
  }
});

app.post("/api/clients/:clientId/real-number", async (req, res) => {
  const { clientId } = req.params;
  const authHeader = req.headers.authorization;
  const { realNumber, notes } = req.body;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: "Unauthorized. Missing Bearer JWT." });
  }
  
  if (!realNumber) {
    return res.status(400).json({ error: "Missing 'realNumber' in JSON body." });
  }

  const token = authHeader.replace('Bearer ', '');
  
  const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !user || user.email !== 'ursache.andrei1995@gmail.com') {
    return res.status(403).json({ error: "Access Denied. Admin only." });
  }

  try {
    await supabase.from('clients').update({
      real_phone_e164: realNumber.replace(/[^0-9]/g, ''),
      real_phone_source: 'manual_admin',
      real_phone_confidence: 100,
      real_phone_updated_at: new Date().toISOString(),
      real_phone_notes: notes || null
    }).eq('id', clientId);
    
    console.log(`[PII Resolver] Admin override forced canonical real hit for ${clientId}: ${realNumber}`);
    
    // Optionally trigger async sibling synchronization to propagate override to clones
    return res.json({ success: true, realNumber: realNumber.replace(/[^0-9]/g, '') });
  } catch (e) {
    console.error(`[PII Resolver Override] Error: ${e.message}`);
    return res.status(500).json({ error: 'Internal Server Error updating PII' });
  }
});


app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    uptime: process.uptime(),
    activeSessions: sessions.size,
  });
});

app.listen(PORT, () => {
  console.log(`Baileys Node Engine running securely on port ${PORT}`);
  console.log(
    `Protecting APIs with Key: ${API_KEY === "SECRET_TOKEN_CHANGE_ME" ? "WARNING: DEFAULT KEY IN USE" : "Custom Key Configured"}`,
  );
  
  try {
    const files = fs.readdirSync(__dirname, { withFileTypes: true });
    for (const file of files) {
      if (file.isDirectory() && file.name.startsWith('_baileys_auth_')) {
        const extractedSessionId = file.name.replace('_baileys_auth_', '');
        console.log(`[Auto-Bootstrap] Detected persisted Baileys session: ${extractedSessionId}. Auto-starting...`);
        startSession(extractedSessionId);
      }
    }
  } catch (e) {
    console.error(`[Auto-Bootstrap] Directory scanning failed: ${e.message}`);
  }
});
