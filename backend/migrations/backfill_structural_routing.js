require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const supabase = require('../supabase');

async function backfill() {
  console.log("Starting Structural Backfill...");
  
  // 1. Get all labeled sessions
  const { data: sessions, error: sessErr } = await supabase
    .from('whatsapp_sessions')
    .select('session_key, label, brand_key, alias_prefix')
    .not('label', 'is', null);
    
  if (sessErr) {
    console.error("Error fetching sessions:", sessErr);
    return;
  }
  
  console.log(`Found ${sessions.length} labeled sessions for backfill.`);

  for (const session of sessions) {
    // Derive structure from valid session row
    const sLabel = session.label.trim();
    const sBk = session.brand_key || sLabel.toUpperCase().replace(/\s+/g, '_');
    const sPrefix = session.alias_prefix || sLabel.split(' ')[0];
    const sKey = session.session_key;
    
    console.log(`\nProcessing Route: ${sLabel} [${sKey}] -> Target Brand: ${sBk}, Prefix: ${sPrefix}`);
    
    // 2. Fetch all conversations tied strictly to this session_key
    const { data: convs, error: convErr } = await supabase
        .from('conversations')
        .select('client_id')
        .eq('session_id', sKey)
        .limit(10000);
        
    if (convErr) {
        console.error(`Error fetching conversations for ${sLabel}:`, convErr);
        continue;
    }
    
    // Filter non-null client IDs
    const clientIds = [...new Set(convs.map(c => c.client_id))].filter(Boolean);
    console.log(`  Identified ${clientIds.length} unique underlying contact IDs sourced from this route.`);
    
    if (clientIds.length === 0) continue;

    // 3. Update in batches
    for (let i = 0; i < clientIds.length; i += 100) {
        const batchIds = clientIds.slice(i, i + 100);
        
        // Find clients that have the WRONG brand or a fallback alias
        const { data: clients, error: cErr } = await supabase
            .from('clients')
            .select('id, public_alias, brand_key')
            .in('id', batchIds);
            
        if (cErr) {
            console.error("Error fetching clients batch:", cErr);
            continue;
        }
        
        for (const client of clients) {
            if (!client.public_alias) continue;

            const needsAliasFix = client.public_alias.startsWith('Unknown') || client.public_alias.startsWith('QR-');
            const needsBrandFix = client.brand_key !== sBk;
            
            if (needsAliasFix || needsBrandFix) {
                let newAlias = client.public_alias;
                if (needsAliasFix) {
                    newAlias = newAlias.replace('Unknown', sPrefix).replace(/QR-[A-Z0-9]+/, sPrefix);
                    // Force the prefix if it was literally just "Unknown"
                    if (newAlias === 'Unknown' || newAlias.startsWith('QR-') || newAlias === sPrefix) {
                        newAlias = `${sPrefix}-${client.id.substring(0,6)}`;
                    }
                }
                
                console.log(`  Fixing Client: ${client.id} | Alias: ${client.public_alias} -> ${newAlias} | Brand: ${client.brand_key} -> ${sBk}`);
                
                // Atomic Update to core Client Identity
                await supabase.from('clients').update({
                    public_alias: newAlias,
                    brand_key: sBk
                }).eq('id', client.id);
                
                // Cascade Brand update to their identifier links (Phones/LIDs)
                await supabase.from('client_identity_links')
                    .update({ brand_key: sBk })
                    .eq('client_id', client.id);
            }
        }
    }
  }
  
  // Bust the current process cache gently
  try {
      const { sessionBrandCache } = require('../clientIdentity');
      sessionBrandCache.clear();
      console.log('\nProcess UI Routing Memory Cache cleared successfully.');
  } catch(e) {}
  
  console.log("\nStructural Backfill Complete!");
}

backfill().catch(console.error);
