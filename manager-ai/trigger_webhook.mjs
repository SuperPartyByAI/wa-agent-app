import fetch from 'node-fetch';

const webhookPayload = {
  message_id: "TEST_MSG_" + Date.now(),
  conversation_id: "3119205d-dbbf-4787-bdad-3129fe2eeebc",
  content: "Spune-mi sincer, de la robot la robot, mai faceți super petreceri?",
  sender_type: "client",
  timestamp: new Date().toISOString()
};

async function triggerAI() {
  console.log("-> Se trimite webhook fals către Manager AI (Port 3001)...");
  try {
    const res = await fetch('http://localhost:3001/webhook/whts-up', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(webhookPayload)
    });
    
    console.log("-> Răspuns Manager AI (HTTP", res.status + "):", await res.text());
  } catch(e) {
    console.error("❌ Eroare la trimiterea webhook-ului fals:", e.message);
  }
}

triggerAI();
