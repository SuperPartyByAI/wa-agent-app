import fetch from 'node-fetch';

const sessionId = "wa_35fd0b0f";
const conversationId = "3119205d-dbbf-4787-bdad-3129fe2eeebc";
const apiKey = "d3vqL8sZp2kT6xN9bR4mY7cD1fG5jH0w";

const payload = {
  sessionId,
  conversationId,
  message_type: 'text',
  text: "🤖 *[DIAGNOSTIC HETZNER]*\\n\\nAceasta este o demonstrație LIVE a faptului că portul tcp `:::3002` (WhatsApp) a preluat mesajul meu! AI-ul se află acum pe rampa de lansare finală și totul funcționează perfect. ✅🚀"
};

async function testPort3002() {
  console.log("-> Se trimite pachetul de demonstrație pe http://localhost:3002/api/messages/send");
  try {
    const res = await fetch('http://localhost:3002/api/messages/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
      body: JSON.stringify(payload)
    });
    
    const text = await res.text();
    console.log("-> Răspuns Server WhatsApp (Status " + res.status + "):", text);
  } catch(e) {
    console.error("-> ❌ EȘEC FATAL: Portul 3002 este închis sau rejectează:", e.message);
  }
}

testPort3002();
