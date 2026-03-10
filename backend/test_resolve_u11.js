const supabase = require('./supabase');
const { resolveClientIdentity } = require('./clientIdentity');
const { updateClientRealPhoneGraph } = require('./pii');

async function testExtraction() {
    console.log("Mocking webhook hook for Superparty-U11...");
    let { data } = await supabase.from('clients').select('id, public_alias, full_name').eq('public_alias', 'Superparty-U11').maybeSingle();
    if (!data) {
       console.log("Not found by alias, trying full_name wildcard...");
       const wildRes = await supabase.from('clients').select('id, public_alias, full_name').ilike('full_name', '%Superparty-U11%').limit(1).maybeSingle();
       data = wildRes.data;
    }
    
    if (!data) return console.log("Not found in database at all.");
    
    console.log(`Found Target ID: ${data.id}`);
    const { data: links } = await supabase.from('client_identity_links').select('identifier_value, identifier_type').eq('client_id', data.id).limit(1).single();
    if (!links) return console.log("No links found for graph injection.");
    
    console.log(`Found Identity Link: ${links.identifier_value}`);

    const phoneOrWaIdentifier = links.identifier_value;
    const altIdentifier = "40742111222@s.whatsapp.net"; // Dummy MSISDN proof
    const sessionId = "wa_138176ff";
    
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
