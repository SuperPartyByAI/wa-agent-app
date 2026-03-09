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
    const { data: existingClient } = await supabase.from('clients').select('id').eq('phone', formattedNumber).single();
    if (existingClient) {
      clientId = existingClient.id;
    } else {
      const { data: newClient } = await supabase.from('clients').insert({ full_name: 'Call-' + formattedNumber, phone: formattedNumber, source: 'call' }).select().single();
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
  const { sessionId, to, text } = req.body;

  if (!sessionId || !to || !text) {
    return res.status(400).json({ error: "Missing sessionId, to, or text" });
  }

  const phoneRegex = /^\+?\d+$/;
  if (!phoneRegex.test(to)) {
    return res.status(400).json({ error: "Invalid phone number format. Must contain only digits." });
  }

  const session = sessions.get(sessionId);
  if (!session || session.status !== "CONNECTED" || !session.client) {
    return res.status(400).json({ error: "Session is not connected or invalid." });
  }

  const formattedNumber = to.replace('+', '');
  
  try {
    let success = false;
    let lastError = null;
    let result = null;

    for (let i = 0; i < 3; i++) {
        try {
            // Baileys structure
            result = await session.client.sendMessage(`${formattedNumber}@s.whatsapp.net`, { text: text });
            success = true;
            break;
        } catch (err) {
            lastError = err;
            logger(sessionId, "warn", `Send attempt ${i + 1} failed for ${formattedNumber}, retrying...`);
            await new Promise(resolve => setTimeout(resolve, 2000));
        }
    }

    if (!success) {
        throw lastError;
    }
    
    // Explicit format mapping for external message ID resolution in Baileys
    const externalId = result?.key?.id || null;
    syncOutboundMessageToSupabase(formattedNumber, text, externalId, sessionId).catch(e => console.error(e));
    
    res.json({ success: true, result });
  } catch (err) {
    logger(sessionId, "error", `Sending failed after retries: ${err.message}`);
    res.status(500).json({ error: "Failed to send message" });
  }
});

app.post("/3cx/event", requireApiKey, async (req, res) => {
  const { event, number, extension, timestamp, sessionId } = req.body;
  
  console.log(`[3CX] Received event: ${event} for number: ${number}`);
  
  let targetSessionId = sessionId;
  
  if (!targetSessionId) {
    const formattedNumber = number.replace('+', '');
    const { data: client } = await supabase.from('clients').select('id').eq('phone', formattedNumber).single();
    if (client) {
      const { data: conv } = await supabase.from('conversations').select('session_id').eq('client_id', client.id).eq('channel', 'whatsapp').single();
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
