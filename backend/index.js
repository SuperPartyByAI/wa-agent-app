require("dotenv").config();
const wa = require("@open-wa/wa-automate");
const express = require("express");
const cors = require("cors");
const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');

// Init Supabase CRM Engine
const SUPABASE_URL = process.env.SUPABASE_URL || "https://jrfhprnuxxfwkwjwdsez.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "INSERT_YOUR_SECRET_ROLE_KEY_HERE";
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

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
    
    // 3. Message
    const { error: msgErr } = await supabase.from('messages').insert({
      conversation_id: convId,
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

async function syncOutboundMessageToSupabase(phoneNumber, text, externalId) {
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

    await supabase.from('messages').insert({
      conversation_id: convId,
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

async function syncHistoricalMessageToSupabase(message) {
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
    
    // 3. Message check for duplicates
    const { data: existingMsg } = await supabase.from('messages').select('id').eq('external_message_id', message.id).single();
    if (existingMsg) return; // Skip duplicate

    // 4. Insert Message
    await supabase.from('messages').insert({
      conversation_id: convId,
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

// Load Config from .env
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.API_KEY || "SECRET_TOKEN_CHANGE_ME";
const WEBHOOK_URL = process.env.WEBHOOK_URL || null;

// Multi-Session Manager Map
const sessions = new Map();
// Structure: sessions.set(sessionId, { client, status, qrCode })

// Middleware: API Protection
const requireApiKey = (req, res, next) => {
  const key = req.headers["x-api-key"] || req.query.api_key;
  if (key !== API_KEY) {
    return res.status(401).json({ error: "Unauthorized: Invalid API Key" });
  }
  next();
};

/**
 * Helper to log structured info
 */
function logger(sessionId, level, message) {
  const timestamp = new Date().toISOString();
  console.log(
    `[${timestamp}] [${level.toUpperCase()}] [Session: ${sessionId}] ${message}`,
  );
}

async function upsertSessionStatus(sessionId, status, phoneNumber = null) {
  try {
    const payload = {
      session_key: sessionId,
      status: status,
      last_seen_at: new Date().toISOString()
    };
    if (phoneNumber) payload.phone_number = phoneNumber;
    
    await supabase.from('whatsapp_sessions').upsert(payload, { onConflict: 'session_key' });
  } catch (err) {
    console.error(`[Supabase Session Status Error] ${err.message}`);
  }
}

/**
 * Watchdog & Recovery Factory
 */
async function startSession(sessionId) {
  if (sessions.has(sessionId)) {
    return { error: "Session already exists or is starting." };
  }

  // Mark as starting
  sessions.set(sessionId, { status: "STARTING", client: null, qrCode: null });
  upsertSessionStatus(sessionId, 'STARTING');
  logger(sessionId, "info", "Initializing new WA session...");

  try {
    const client = await wa.create({
      sessionId: sessionId,
      multiDevice: true,
      authTimeout: 60,
      blockCrashLogs: true,
      disableSpins: true,
      headless: true,
      logConsole: false,
      popup: false,
      qrTimeout: 0, // 0 = wait forever for QR
      executablePath: '/usr/bin/google-chrome',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
    });

    // Update struct
    sessions.set(sessionId, {
      status: "CONNECTED",
      client: client,
      qrCode: null,
    });
    let botNumber = null;
    try {
        const me = await client.getMe();
        if (me && me.wid) botNumber = me.wid.replace('@c.us', '').split(':')[0];
    } catch(e) {}
    upsertSessionStatus(sessionId, 'CONNECTED', botNumber);
    logger(sessionId, "info", "Successfully connected and paired!");

    // Start historical seed in background
    (async () => {
      try {
        logger(sessionId, "info", "Starting initial history seed for last 10 chats...");
        const chats = await client.getAllChats();
        const recentChats = chats.filter(c => c.id.server === 'c.us').slice(0, 10);
        for (const chat of recentChats) {
          try {
            const msgs = await client.getAllMessagesInChat(chat.id._serialized || chat.id, true, true);
            const last20 = msgs.slice(-20);
            for (const msg of last20) {
              await syncHistoricalMessageToSupabase(msg);
            }
          } catch (chatErr) {
            console.error(`Failed to sync chat ${chat.id}: ${chatErr.message}`);
          }
        }
        logger(sessionId, "info", "Initial history seed completed successfully.");
      } catch (seedErr) {
        logger(sessionId, "error", `Failed history seed: ${seedErr.message}`);
      }
    })();

    // Bind global event listeners for reconnecting and stability
    client.onStateChanged((state) => {
      logger(sessionId, "warn", `State changed to: ${state}`);
      if (state === "CONFLICT" || state === "UNLAUNCHED") {
        client.forceRefocus(); // Recover from background sleep
      }
      if (state === "UNPAIRED") {
        logger(
          sessionId,
          "error",
          "Session was disconnected from the phone. Manual re-scan required.",
        );
        sessions.get(sessionId).status = "DISCONNECTED";
        upsertSessionStatus(sessionId, 'DISCONNECTED');
      } else if (state === "CONFLICT") {
        upsertSessionStatus(sessionId, 'CONFLICT');
      } else {
        upsertSessionStatus(sessionId, state);
      }
    });

    // Bind incoming message routing (Webhook / 3CX placeholder)
    client.onMessage(async (message) => {
      logger(sessionId, "info", `Received message from ${message.from}`);
      
      // Upsert into Supabase CRM Database asynchronously
      syncInboundMessageToSupabase(message, sessionId).catch(e => console.error(e));
      
      if (WEBHOOK_URL) {
        try {
          await fetch(WEBHOOK_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              event: 'whatsapp_message_received',
              sessionId: sessionId,
              from: message.from,
              text: message.body || message.text || "",
              timestamp: Date.now()
            })
          });
          logger(sessionId, "info", `Successfully routed message to 3CX webhook.`);
        } catch (err) {
          logger(sessionId, "error", `Failed to route message to webhook: ${err.message}`);
        }
      }
    });

    return { success: true, sessionId };
  } catch (error) {
    logger(sessionId, "error", `Failed to start: ${error.message}`);
    sessions.delete(sessionId);
    return { error: "Failed to start session", details: error.message };
  }
}

/**
 * WA-Automate global ev trigger for QR capture.
 * Since wa.create blocks until connected, we capture QR using the global event emitter.
 */
wa.ev.on("qr.**", async (qrcode, sessionId) => {
  logger(sessionId, "info", "QR Code generated! Awaiting scan...");
  if (sessions.has(sessionId)) {
    sessions.get(sessionId).status = "AWAITING_QR";
    sessions.get(sessionId).qrCode = qrcode; // Save raw image data or string
    upsertSessionStatus(sessionId, 'AWAITING_QR');
  }
});

// ----------------------------------------------------
// REST API ENDPOINTS
// ----------------------------------------------------

// 1. Start a new session or load existing from persistence
app.post("/api/sessions/start", requireApiKey, async (req, res) => {
  const { sessionId } = req.body;
  if (!sessionId)
    return res.status(400).json({ error: "sessionId is required" });

  // Non-blocking start
  startSession(sessionId);
  res.json({ message: `Session ${sessionId} initialization started.` });
});

// 2. Get status of all or a specific session
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

  // Return all
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
    try { await session.client.kill(); } catch(e) {}
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
    try { await session.client.kill(); } catch(e) {}
  }
  sessions.delete(sessionId);
  await upsertSessionStatus(sessionId, 'DISCONNECTED');
  res.json({ message: `Session ${sessionId} killed and removed.` });
});

// 3. Send Message
app.post("/api/messages/send", requireApiKey, async (req, res) => {
  const { sessionId, to, text } = req.body;

  if (!sessionId || !to || !text) {
    return res.status(400).json({ error: "Missing sessionId, to, or text" });
  }

  // Exact number validation (can include optional + prefix)
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

    // Retry Queue mechanism (Max 3 attempts, 2-sec backoff)
    for (let i = 0; i < 3; i++) {
        try {
            result = await session.client.sendText(`${formattedNumber}@c.us`, text);
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
    
    // Upsert into Supabase CRM Database asynchronously
    syncOutboundMessageToSupabase(formattedNumber, text, result).catch(e => console.error(e));
    
    res.json({ success: true, result });
  } catch (err) {
    logger(sessionId, "error", `Sending failed after retries: ${err.message}`);
    res.status(500).json({ error: "Failed to send message" });
  }
});

// 4. 3CX Webhook Receiver
app.post("/3cx/event", requireApiKey, async (req, res) => {
  const { event, number, extension, timestamp, sessionId } = req.body;
  
  console.log(`[3CX] Received event: ${event} for number: ${number}`);
  
  // Find target session
  let targetSession = null;
  if (sessionId && sessions.has(sessionId)) {
    targetSession = sessions.get(sessionId);
  } else {
    // Fallback to first connected session
    for (const [id, session] of sessions.entries()) {
      if (session.status === "CONNECTED" && session.client) {
        targetSession = session;
        break;
      }
    }
  }

  if (!targetSession) {
    return res.status(400).json({ error: "No connected WhatsApp session available to handle 3CX event." });
  }

  try {
    // Upsert into Supabase CRM Database asynchronously
    sync3cxCallEvent(event, number, extension).catch(e => console.error(e));

    if (event === "call_incoming") {
      const message = `[Sistem] Apel de intrare pe extensia ${extension} de la ${number}.`;
      // trimitem notificare WhatsApp folosind numărul apelantului formatat (fără +)
      const formattedNumber = number.replace('+', '');
      await targetSession.client.sendText(`${formattedNumber}@c.us`, message);
      console.log(`[3CX Action] Sent WA message to ${formattedNumber}`);
    }
    res.json({ success: true, message: "Event processed and WA message triggered." });
  } catch (err) {
    console.error(`[3CX Error] ${err.message}`);
    res.status(500).json({ error: "Failed to process 3CX event" });
  }
});

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    uptime: process.uptime(),
    activeSessions: sessions.size,
  });
});

app.listen(PORT, () => {
  console.log(`Open-WA Multi-Session Manager running securely on port ${PORT}`);
  console.log(
    `Protecting APIs with Key: ${API_KEY === "SECRET_TOKEN_CHANGE_ME" ? "WARNING: DEFAULT KEY IN USE" : "Custom Key Configured"}`,
  );
  
  // Auto-bootstrap any found WA sessions
  try {
    const files = fs.readdirSync(__dirname, { withFileTypes: true });
    for (const file of files) {
      if (file.isDirectory() && file.name.startsWith('_IGNORE_') && file.name !== '_IGNORE_WA_SESSION') {
        const extractedSessionId = file.name.replace('_IGNORE_', '');
        if (extractedSessionId) {
          console.log(`[BOOTSTRAP] Auto-initializing existing session from disk: ${extractedSessionId}`);
          startSession(extractedSessionId);
        }
      }
    }
  } catch (err) {
    console.error(`[BOOTSTRAP Error] Failed to scan directory: ${err.message}`);
  }
});
