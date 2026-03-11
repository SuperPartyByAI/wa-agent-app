require('dotenv').config();
const { syncHistoricalMessageToSupabase } = require('./messages');

async function simulateInbound() {
  console.log("=== SIMULATING BAILEYS INBOUND TEXT PIPELINE DIRECTLY ===");

  const testPhone = "40799988899"; // Brand new phantom phone number
  
  const mockMsg = {
      key: {
          remoteJid: `${testPhone}@s.whatsapp.net`,
          fromMe: false,
          id: "MOCK_MSG_" + Date.now()
      },
      message: {
          conversation: "Confirming the backend pipeline is fully restored!"
      },
      messageTimestamp: Math.floor(Date.now() / 1000)
  };

  try {
      console.log("Triggering syncHistoricalMessageToSupabase...");
      await syncHistoricalMessageToSupabase(mockMsg, 'wa_epic', null);
      console.log("Pipeline executed. A new client should have been inserted and message saved.");
  } catch (error) {
      console.error("FATAL PIPELINE CRASH:", error);
  }
}

simulateInbound();
