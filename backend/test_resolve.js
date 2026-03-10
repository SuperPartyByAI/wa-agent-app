const { resolveClientIdentity } = require('./clientIdentity');
const { updateClientRealPhoneGraph } = require('./pii');

async function testExtraction() {
    console.log("Mocking webhook hook for Y1...");
    // Emulating the exact payload from the JSON dumper
    const phoneOrWaIdentifier = "153407742578775@lid";
    const altIdentifier = "40737571397@s.whatsapp.net";
    const sessionId = "wa_138176ff"; // Match the session from logs
    
    try {
        const client = await resolveClientIdentity(phoneOrWaIdentifier, sessionId, altIdentifier);
        if (client) {
            console.log(`Successfully bound identifiers for ${client.id}! Triggering PII engine...`);
            await updateClientRealPhoneGraph(client.id);
            console.log("PII Graph update complete.");
        }
    } catch(err) {
        console.error("Mock Execution Failed:", err);
    }
}

testExtraction().then(() => process.exit(0));
