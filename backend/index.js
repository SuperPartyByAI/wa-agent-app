require("dotenv").config();
const express = require("express");
const cors = require("cors");
const fs = require('fs');

const supabase = require('./supabase');
const { syncOutboundMessageToSupabase } = require('./messages');
const { sessions, startSession, upsertSessionStatus, logger } = require('./sessions');

async function sync3cxCallEvent(event, number, extension) {
  try {
    const formattedNumber = number.replace('+', '');
    
    let clientId = null;
    const { data: existingClient } = await supabase.from('clients').select('id').eq('phone', formattedNumber).order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (existingClient) {
      clientId = existingClient.id;
    } else {
      const { data: newClient } = await supabase.from('clients').insert({ full_name: 'Call-' + formattedNumber, phone: formattedNumber, source: 'call', brand_key: 'system' }).select().limit(1).maybeSingle();
      clientId = newClient?.id;
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
  let { sessionId: requestedSessionId, text, conversationId } = req.body;

  if (!requestedSessionId || !conversationId || !text) {
    return res.status(400).json({ error: "Missing sessionId, conversationId, or text" });
  }

  // Organic identity derived securely avoiding UI leaks
  const { data: convData } = await supabase.from('conversations').select('client_id, session_id').eq('id', conversationId).single();
  if (!convData) return res.status(404).json({ error: "Conversation not found" });

  // Strictly bind the message transmission to the brand session that owns the conversation
  if (convData.session_id) {
      requestedSessionId = convData.session_id;
  }

  const { data: clientData } = await supabase.from('clients').select('phone, wa_identifier').eq('id', convData.client_id).single();
  if (!clientData) return res.status(404).json({ error: "Client identity missing from conversation link" });

  // Resolve logical physical routes
  let to = clientData.wa_identifier || clientData.phone;
  let isLid = String(to).includes('@lid') || String(to).includes('@g.us');

  if (!isLid) {
    to = String(to).replace(/[^0-9+]/g, '');
    const phoneRegex = /^\+?\d+$/;
    if (!phoneRegex.test(to)) {
      return res.status(400).json({ error: "Native client routing format corrupted." });
    }
  }

  let activeSessionId = requestedSessionId;
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

    for (let i = 0; i < 3; i++) {
        try {
            // Baileys structure
            result = await activeSession.client.sendMessage(targetJid, { text: text });
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
    syncOutboundMessageToSupabase(formattedRoute, text, externalId, activeSessionId, activeSession.client).catch(e => {
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

app.post("/3cx/event", requireApiKey, async (req, res) => {
  const { event, number, extension, timestamp, sessionId } = req.body;
  
  console.log(`[3CX] Received event: ${event} for number: ${number}`);
  
  let targetSessionId = sessionId;
  
  if (!targetSessionId) {
    const formattedNumber = number.replace('+', '');
    const { data: client } = await supabase.from('clients').select('id').eq('phone', formattedNumber).order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (client) {
      const { data: conv } = await supabase.from('conversations').select('session_id').eq('client_id', client.id).eq('channel', 'whatsapp').order('updated_at', { ascending: false }).limit(1).maybeSingle();
      if (conv && conv.session_id) targetSessionId = conv.session_id;
    }
  }

  let targetSession = null;
  if (targetSessionId && sessions.has(targetSessionId)) {
    targetSession = sessions.get(targetSessionId);
  }

  if (!targetSession) {
    return res.status(400).json({ error: "Strict Routing Failed: No explicit connected WhatsApp session found in CRM for this caller." });
  }

  try {
    sync3cxCallEvent(event, number, extension).catch(e => console.error(e));

    if (event === "call_incoming") {
      const message = `[Sistem] Apel de intrare pe extensia ${extension} de la ${number}.`;
      const formattedNumber = number.replace('+', '');
      // Baileys structure
      await targetSession.client.sendMessage(`${formattedNumber}@s.whatsapp.net`, { text: message });
      console.log(`[3CX Action] Sent WA message to ${formattedNumber}`);
    }
    res.json({ success: true, message: "Event processed and WA message triggered." });
  } catch (err) {
    console.error(`[3CX Error] ${err.message}`);
    res.status(500).json({ error: "Failed to process 3CX event" });
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
