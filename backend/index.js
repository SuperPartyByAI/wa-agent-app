require("dotenv").config();
const wa = require("@open-wa/wa-automate");
const express = require("express");
const cors = require("cors");
const fs = require('fs');

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

/**
 * Watchdog & Recovery Factory
 */
async function startSession(sessionId) {
  if (sessions.has(sessionId)) {
    return { error: "Session already exists or is starting." };
  }

  // Mark as starting
  sessions.set(sessionId, { status: "STARTING", client: null, qrCode: null });
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
      // persistence is automatically handled by open-wa storing in local session folder per sessionId
    });

    // Update struct
    sessions.set(sessionId, {
      status: "CONNECTED",
      client: client,
      qrCode: null,
    });
    logger(sessionId, "info", "Successfully connected and paired!");

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
      }
    });

    // Bind incoming message routing (Webhook / 3CX placeholder)
    client.onMessage(async (message) => {
      logger(sessionId, "info", `Received message from ${message.from}`);
      
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
