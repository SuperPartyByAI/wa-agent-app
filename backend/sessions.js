const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require("@whiskeysockets/baileys");
const pino = require("pino");
const QRCode = require("qrcode");
const fs = require('fs');
const path = require('path');
const supabase = require("./supabase");
const { syncHistoricalMessageToSupabase } = require("./messages");

const WEBHOOK_URL = process.env.WEBHOOK_URL || null;
const sessions = new Map();

function logger(sessionId, level, message) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] [${level.toUpperCase()}] [Session: ${sessionId}] ${message}`);
}

async function upsertSessionStatus(sessionId, status, phoneNumber = null) {
  try {
    const payload = {
      session_key: sessionId,
      status,
      last_seen_at: new Date().toISOString()
    };

    if (phoneNumber) payload.phone_number = phoneNumber;

    const { error } = await supabase.from("whatsapp_sessions").upsert(payload, { onConflict: "session_key" });
    if (error) console.error(`[Supabase Session Status UPSERT ERROR]`, error);
  } catch (err) {
    console.error(`[Supabase Session Status Error] ${err.message}`);
  }
}

async function startSession(sessionId) {
  if (sessions.has(sessionId) && sessions.get(sessionId).status !== "DISCONNECTED") {
    return { error: "Session already exists or is starting." };
  }

  sessions.set(sessionId, { status: "STARTING", client: null, qrCode: null });
  await upsertSessionStatus(sessionId, "STARTING");
  logger(sessionId, "info", "Initializing new Baileys WA session...");

  try {
    const authFolder = path.join(__dirname, `_baileys_auth_${sessionId}`);
    const { state, saveCreds } = await useMultiFileAuthState(authFolder);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
      version,
      auth: state,
      printQRInTerminal: false,
      logger: pino({ level: 'silent' }),
      browser: ['SuperpartyCRM', 'Chrome', '145.0.0']
    });

    sessions.set(sessionId, { status: "STARTING", client: sock, qrCode: null });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        try {
          const qrImageDataUrl = await QRCode.toDataURL(qr, { errorCorrectionLevel: "L", margin: 1, width: 512 });
          const sess = sessions.get(sessionId);
          if (sess) {
            sess.status = "AWAITING_QR";
            sess.qrCode = qrImageDataUrl;
          }
          await upsertSessionStatus(sessionId, "AWAITING_QR");
          logger(sessionId, "info", "QR Code generated natively. Awaiting mobile scan...");
        } catch (err) {
          logger(sessionId, "error", `QR conversion failed: ${err.message}`);
        }
      }

      if (connection === 'close') {
        const shouldReconnect = (lastDisconnect?.error)?.output?.statusCode !== DisconnectReason.loggedOut;
        logger(sessionId, "warn", `Connection closed. Reason: ${lastDisconnect?.error?.message}. Should reconnect: ${shouldReconnect}`);
        
        if (shouldReconnect) {
          sessions.get(sessionId).status = "STARTING";
          startSession(sessionId); // Native retry
        } else {
          logger(sessionId, "error", "Device brutally logged out. Purging Auth Directory.");
          sessions.get(sessionId).status = "DISCONNECTED";
          sessions.get(sessionId).client = null;
          await upsertSessionStatus(sessionId, "DISCONNECTED");
          fs.rmSync(authFolder, { recursive: true, force: true });
        }
      }

      if (connection === 'open') {
        let botNumber = sock.user?.id?.split(':')[0];
        const sess = sessions.get(sessionId);
        if (sess) {
          sess.status = "CONNECTED";
          sess.qrCode = null;
        }
        await upsertSessionStatus(sessionId, "CONNECTED", botNumber);
        logger(sessionId, "info", "Successfully linked with Baileys WebSocket!");
        
        // Emulate Open-WA History Seed by actively reading standard native chat histories from Baileys if populated.
        // In Baileys, history sync happens async via "messaging-history.set" events.
      }
    });

    sock.ev.on('messaging-history.set', async ({ chats, messages, isLatest }) => {
        logger(sessionId, "info", `[History Sync] Seed triggered. Processing ${messages.length} legacy buffers...`);
        for (const msg of messages) {
           await syncHistoricalMessageToSupabase(msg, sessionId).catch(e => {});
        }
    });

    sock.ev.on('messages.upsert', async (m) => {
      // m.type === 'notify' means real new message physically sent
      if (m.type === 'notify') {
        for (const msg of m.messages) {
          logger(sessionId, "info", `[messages.upsert Hook] Remote: ${msg.key.remoteJid} | FromMe: ${msg.key.fromMe}`);
          await syncHistoricalMessageToSupabase(msg, sessionId).catch(e => console.error(e));
          
          if (!msg.key.fromMe && WEBHOOK_URL) {
            try {
              await fetch(WEBHOOK_URL, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  event: "whatsapp_message_received",
                  sessionId,
                  from: msg.key.remoteJid,
                  text: msg.message?.conversation || msg.message?.extendedTextMessage?.text || "",
                  timestamp: Date.now()
                })
              });
            } catch (err) {}
          }
        }
      }
    });

    return { success: true, sessionId };
  } catch (error) {
    logger(sessionId, "error", `Fatal Error binding socket: ${error.message}`);
    sessions.delete(sessionId);
    await upsertSessionStatus(sessionId, "DISCONNECTED");
    return { error: "Failed to allocate Baileys engine", details: error.message };
  }
}

module.exports = {
  sessions,
  startSession,
  upsertSessionStatus,
  logger
};
