require('dotenv').config({ path: '/root/backend/.env' });
const supabase = require('/root/backend/supabase.js');
const { rebaseRouteAliases } = require('/root/backend/clientIdentity.js');

async function execute() {
  console.log("Starting Rebase Backfill for historical human-labeled sessions...");
  
  // Find all sessions that ARE NOT technical fallbacks (i.e. they do not start with QR-)
  // and ARE NOT null
  const { data: sessions, error: sessErr } = await supabase
    .from('whatsapp_sessions')
    .select('session_key, label, brand_key, alias_prefix')
    .not('label', 'is', null)
    .not('label', 'ilike', 'QR-%')
    .not('label', 'ilike', 'Unknown%');
    
  if (sessErr) {
    console.error("Error fetching sessions:", sessErr);
    return;
  }
  
  console.log(`Found ${sessions.length} sessions with human labels needing verification.`);

  for (const session of sessions) {
    const sKey = session.session_key;
    const sLabel = session.label;
    const sBk = session.brand_key;
    const sPrefix = session.alias_prefix;
    
    console.log(`\nVerifying Route: [${sKey}] -> Invoking Rebase to Brand: ${sBk}, Prefix: ${sPrefix}`);
    
    // Leverage the exact same structural function we injected into the rename API
    await rebaseRouteAliases(sKey, sLabel, sBk, sPrefix);
  }
  
  console.log("\nRebase Backfill Complete!");
}

execute().then(() => {
    process.exit(0);
}).catch(e => {
    console.error(e);
    process.exit(1);
});
