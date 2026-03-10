require('dotenv').config({ path: '/root/backend/.env' });
const supabase = require('/root/backend/supabase.js');

async function backfillUnlabeled() {
  console.log("Starting Backfill for Unlabeled Sessions...");
  
  const { data: sessions, error: sessErr } = await supabase
    .from('whatsapp_sessions')
    .select('session_key, label, brand_key, alias_prefix')
    .is('label', null);
    
  if (sessErr) {
    console.error("Error fetching sessions:", sessErr);
    return;
  }
  
  console.log(`Found ${sessions.length} unlabeled sessions for backfill.`);

  for (const session of sessions) {
    const sKey = session.session_key;
    const safeSuffix = sKey.replace('wa_', '').substring(0, 6).toUpperCase();
    
    const sLabel = `QR-${safeSuffix}`;
    const sBk = `SESSION_${safeSuffix}`;
    const sPrefix = `QR-${safeSuffix}`;
    
    console.log(`\nProcessing Unlabeled Route: [${sKey}] -> Forcing Target Brand: ${sBk}, Prefix: ${sPrefix}`);
    
    // 1. Force the database session to possess this fallback structurally
    await supabase.from('whatsapp_sessions').update({
        label: sLabel,
        brand_key: sBk,
        alias_prefix: sPrefix
    }).eq('session_key', sKey);

    // 2. Fetch all conversations tied strictly to this session_key
    const { data: convs, error: convErr } = await supabase
        .from('conversations')
        .select('client_id')
        .eq('session_id', sKey)
        .limit(10000);
        
    if (convErr) {
        console.error(`Error fetching conversations for ${sKey}:`, convErr);
        continue;
    }
    
    const clientIds = [...new Set(convs.map(c => c.client_id))].filter(Boolean);
    console.log(`  Identified ${clientIds.length} unique contact IDs sourced from this route.`);
    
    if (clientIds.length === 0) continue;

    for (let i = 0; i < clientIds.length; i += 100) {
        const batchIds = clientIds.slice(i, i + 100);
        
        const { data: clients, error: cErr } = await supabase
            .from('clients')
            .select('id, public_alias, brand_key')
            .in('id', batchIds);
            
        if (cErr) continue;
        
        for (const client of clients) {
            if (!client.public_alias) continue;

            // We FORCE everyone on this unassigned route to carry the QR- fallback identity
            // to wipe out the contaminated "Unknown-" or mismatched "Galaxy" aliases from the failed first backfill
            const newAlias = `${sPrefix}-${client.id.substring(0,6)}`;
            
            console.log(`  Fixing Client: ${client.id} | Alias: ${client.public_alias} -> ${newAlias} | Brand: ${client.brand_key} -> ${sBk}`);
            
            await supabase.from('clients').update({
                public_alias: newAlias,
                brand_key: sBk
            }).eq('id', client.id);
            
            await supabase.from('client_identity_links')
                .update({ brand_key: sBk })
                .eq('client_id', client.id);
        }
    }
  }
}

backfillUnlabeled().then(() => {
    console.log("\nUnlabeled Backfill Complete!");
    process.exit(0);
}).catch(e => {
    console.error(e);
    process.exit(1);
});
