const wa = require("@open-wa/wa-automate");
const QRCode = require("qrcode");
const supabase = require("./supabase");
const { syncInboundMessageToSupabase, syncHistoricalMessageToSupabase } = require("./messages");

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
    if (error) {
      console.error(`[Supabase Session Status UPSERT ERROR]`, error);
    }
  } catch (err) {
    console.error(`[Supabase Session Status Error] ${err.message}`);
  }
}

async function startSession(sessionId) {
  if (sessions.has(sessionId)) {
    return { error: "Session already exists or is starting." };
  }

  sessions.set(sessionId, { status: "STARTING", client: null, qrCode: null });
  await upsertSessionStatus(sessionId, "STARTING");
  logger(sessionId, "info", "Initializing new WA session...");

  try {
    const client = await wa.create({
      sessionId,
      multiDevice: true,
      authTimeout: 60,
      blockCrashLogs: true,
      disableSpins: true,
      headless: true,
      logConsole: false,
      popup: false,
      qrTimeout: 0,
      executablePath: "/usr/bin/google-chrome",
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu"
      ]
    });

    sessions.set(sessionId, {
      status: "CONNECTED",
      client,
      qrCode: null
    });

    let botNumber = null;
    try {
      const me = await client.getMe();
      if (me && me.wid) {
        botNumber = me.wid.replace("@c.us", "").split(":")[0];
      }
    } catch (_) {}

    await upsertSessionStatus(sessionId, "CONNECTED", botNumber);
    logger(sessionId, "info", "Successfully connected and paired!");

    (async () => {
      try {
        logger(sessionId, "info", "Starting initial history seed for last 10 chats...");
        const chats = await client.getAllChats();
        const recentChats = chats.filter((c) => c.id.server === "c.us").slice(0, 10);

        for (const chat of recentChats) {
          try {
            const chatId = chat.id._serialized || chat.id;
            const msgs = await client.getAllMessagesInChat(chatId, true, true);
            const last20 = msgs.slice(-20);

            for (const msg of last20) {
              await syncHistoricalMessageToSupabase(msg, sessionId);
            }
          } catch (chatErr) {
            console.error(`Failed to sync chat ${chat.id}: ${chatErr.message}`);
          }
        }

        logger(sessionId, "info", "Initial history seed completed.");
      } catch (seedErr) {
        logger(sessionId, "error", `Failed history seed: ${seedErr.message}`);
      }
    })();

    client.onStateChanged((state) => {
      logger(sessionId, "warn", `State changed to: ${state}`);

      if (state === "CONFLICT" || state === "UNLAUNCHED") {
        client.forceRefocus();
      }

      if (state === "UNPAIRED") {
        logger(sessionId, "error", "Session disconnected. Manual re-scan required.");
        const existing = sessions.get(sessionId);
        if (existing) existing.status = "DISCONNECTED";
        upsertSessionStatus(sessionId, "DISCONNECTED");
      } else if (state === "CONFLICT") {
        upsertSessionStatus(sessionId, "CONFLICT");
      } else {
        upsertSessionStatus(sessionId, state);
      }
    });

    client.onMessage(async (message) => {
      logger(sessionId, "info", `Received message from ${message.from}`);
      syncInboundMessageToSupabase(message, sessionId).catch((e) => console.error(e));

      if (WEBHOOK_URL) {
        try {
          await fetch(WEBHOOK_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              event: "whatsapp_message_received",
              sessionId,
              from: message.from,
              text: message.body || message.text || "",
              timestamp: Date.now()
            })
          });
          logger(sessionId, "info", "Successfully routed message to 3CX webhook.");
        } catch (err) {
          logger(sessionId, "error", `Failed to route message to webhook: ${err.message}`);
        }
      }
    });

    return { success: true, sessionId };
  } catch (error) {
    logger(sessionId, "error", `Failed to start: ${error.message}`);
    sessions.delete(sessionId);
    await upsertSessionStatus(sessionId, "DISCONNECTED");
    return { error: "Failed to start session", details: error.message };
  }
}

wa.ev.on("qr.**", async (qrcode, sessionId) => {
  logger(sessionId, "info", "QR Code generated! Awaiting scan...");

  if (!sessions.has(sessionId)) return;

  try {
    let qrImageDataUrl;
    if (typeof qrcode === 'string' && qrcode.startsWith('data:image/')) {
        qrImageDataUrl = qrcode;
    } else {
        qrImageDataUrl = await QRCode.toDataURL(qrcode, {
          errorCorrectionLevel: "L",
          margin: 1,
          width: 512
        });
    }

    const session = sessions.get(sessionId);
    session.status = "AWAITING_QR";
    session.qrCode = qrImageDataUrl;

    await upsertSessionStatus(sessionId, "AWAITING_QR");
    logger(sessionId, "info", "QR converted to PNG data URL successfully.");
  } catch (err) {
    logger(sessionId, "error", `QR image conversion failed: ${err.message}`);

    const session = sessions.get(sessionId);
    session.status = "AWAITING_QR";
    session.qrCode = null;

    await upsertSessionStatus(sessionId, "AWAITING_QR");
  }
});

module.exports = {
  sessions,
  startSession,
  upsertSessionStatus,
  logger
};
