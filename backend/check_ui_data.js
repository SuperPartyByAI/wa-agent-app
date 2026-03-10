require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkAndroidPayload() {
    console.log("Checking what Android actually sees for Superparty-U11...");
    
    // 1. Get exact client ID mapping Android sees
    const { data: clientData, error: err } = await supabase
        .from('clients')
        .select('id, public_alias, real_phone_e164')
        .eq('public_alias', 'Superparty-U11')
        .limit(1)
        .single();
        
    if (err || !clientData) return console.log("Error querying client:", err?.message || "Not Found");
    
    console.log("Client Target:", JSON.stringify(clientData, null, 2));

    // 2. See what conversation ID maps to this client ID
    const { data: convData, error: convErr } = await supabase
        .from('conversations')
        .select('id, client_id, updated_at')
        .eq('client_id', clientData.id)
        .limit(1)
        .single();
        
    if (convErr || !convData) return console.log("Error querying conversations:", convErr?.message || "Not Found");
        
    console.log("Mapped Conversation:", JSON.stringify(convData, null, 2));
}

checkAndroidPayload().then(() => process.exit(0));
