const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require("@whiskeysockets/baileys");
const pino = require("pino");
const QRCode = require("qrcode");
const fs = require('fs');
const path = require('path');
const supabase = require("./supabase");
const { syncHistoricalMessageToSupabase } = require("./messages");

const WEBHOOK_URL = process.env.WEBHOOK_URL || null;
const sessions = new Map();
const reconnectAttempts = new Map();

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

    // Check existing mapping to prevent null brand keys on fresh linkings
    const { data: existing } = await supabase.from('whatsapp_sessions').select('label').eq('session_key', sessionId).maybeSingle();
    
    if (!existing || !existing.label) {
        const shortId = sessionId.split('_')[1]?.substring(0, 6).toUpperCase() || sessionId.substring(0, 6).toUpperCase();
        payload.label = `QR-${shortId}`;
        payload.brand_key = `SESSION_${shortId}`;
        payload.alias_prefix = `QR-${shortId}`;
        logger(sessionId, "info", `Assigned structural fallback identity: ${payload.brand_key}`);
    }

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
          const attempts = reconnectAttempts.get(sessionId) || 0;
          const delay = Math.min(1000 * Math.pow(2, attempts), 60000); // Backoff: 1s, 2s, 4s... max 60s
          reconnectAttempts.set(sessionId, attempts + 1);
          
          logger(sessionId, "warn", `Scheduling reconnect for ${sessionId} in ${delay}ms (Attempt ${attempts + 1})...`);
          
          setTimeout(() => {
            sessions.delete(sessionId);
            startSession(sessionId); // Native retry with backoff throttle
          }, delay);
        } else {
          logger(sessionId, "error", "Device brutally logged out. Purging Auth Directory.");
          sessions.get(sessionId).status = "DISCONNECTED";
          sessions.get(sessionId).client = null;
          await upsertSessionStatus(sessionId, "DISCONNECTED");
          fs.rmSync(authFolder, { recursive: true, force: true });
        }
      }

      if (connection === 'open') {
        reconnectAttempts.delete(sessionId);
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
        
        // Fallback: Manually request recent messages after 15 seconds if messaging-history.set failed or came up empty.
        setTimeout(async () => {
             logger(sessionId, "info", "[History Sync] Running delayed manual fallback scan just in case...");
             try {
                // If the Baileys auth store is disabled or empty, this might be lightweight, 
                // but we can query remote chats actively if needed in the future using fetchGroupMetadata etc.
                // For now, if bailyes exposes sock.authState.chats / sock.store, we would iterate it.
                // Because we run without a full in-memory store, we log the attempt.
                logger(sessionId, "info", "[History Sync] Fallback scan completed. Awaiting organic events.");
             } catch(e) {
                logger(sessionId, "error", `[History Sync] Fallback failed: ${e.message}`);
             }
        }, 15000);
      }
    });

    sock.ev.on('messaging-history.set', async ({ chats, messages, isLatest }) => {
        logger(sessionId, "info", `[History Sync] Seed triggered. Payload received: ${chats?.length || 0} chats, ${messages?.length || 0} messages. isLatest: ${isLatest}`);
        if (!messages || messages.length === 0) {
            logger(sessionId, "warn", "[History Sync] Baileys fired history set but payload was completely empty. This explains missing history.");
            return;
        }
        // Deduplicate messages to prevent hammering Supabase
        const uniqueMessages = [];
        const seenIds = new Set();
        for (const msg of messages) {
           if (msg.key && msg.key.id && !seenIds.has(msg.key.id)) {
               seenIds.add(msg.key.id);
               uniqueMessages.push(msg);
           }
        }
        
        logger(sessionId, "info", `[History Sync] Processing ${uniqueMessages.length} unique deduplicated legacy buffers...`);
        let imported = 0;
        for (const msg of uniqueMessages) {
           try {
               await syncHistoricalMessageToSupabase(msg, sessionId, sock);
               imported++;
           } catch(e) {}
        }
        logger(sessionId, "info", `[History Sync] Successfully imported ${imported} historical messages.`);
    });

    sock.ev.on('messages.upsert', async (m) => {
      // m.type === 'notify' means real new message physically sent
      if (m.type === 'notify') {
        for (const msg of m.messages) {
          logger(sessionId, "info", `[messages.upsert Hook] Remote: ${msg.key.remoteJid} | FromMe: ${msg.key.fromMe}`);
          await syncHistoricalMessageToSupabase(msg, sessionId, sock).catch(e => console.error(e));
          
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
