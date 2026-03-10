const supabase = require('./supabase');
const { getClientGraphPhone, updateClientRealPhoneGraph } = require('./pii');

async function runBackfill() {
  console.log("Starting Auto-Capture Canonical Real Phone Backfill Sweep...");
  
  let processedClients = 0;
  let manualOverrides = 0;
  let sourceCounts = {
    msisdn: 0,
    jid: 0,
    contact_vcard: 0,
    '3cx_call_event': 0,
    crm_manual: 0,
    facebook: 0,
    website: 0,
    instagram: 0,
    manual: 0,
    whatsapp: 0,
    call: 0,
    other: 0
  };
  let numărIndisponibil = 0;
  
  // Keep track of graph siblings we've already synced, to avoid redundant processing
  const skipList = new Set();
  
  let offset = 0;
  const limit = 1000;
  
  let totalProcessedUniqueClients = 0;

  while (true) {
    const { data: clients, error } = await supabase
      .from('clients')
      .select('id, real_phone_confidence')
      .range(offset, offset + limit - 1);

    if (error || !clients || clients.length === 0) break;
    
    for (const client of clients) {
        if (skipList.has(client.id)) continue;
        
        totalProcessedUniqueClients++;
        
        if (client.real_phone_confidence === 100) {
            manualOverrides++;
            continue;
        }
        
        // Use the simulation graph to just get the stats, then let the original update function run physics
        const bestMatch = await getClientGraphPhone(client.id);
        
        if (bestMatch && bestMatch.siblingClientIds) {
            // Add all siblings to skip list so we don't count the graph twice
            bestMatch.siblingClientIds.forEach(id => skipList.add(id));
            
            if (bestMatch.confidence >= (client.real_phone_confidence || 0)) {
                // Actually apply it to all clones
                await updateClientRealPhoneGraph(client.id);
                
                sourceCounts[bestMatch.source] = (sourceCounts[bestMatch.source] || 0) + bestMatch.siblingClientIds.length;
                processedClients += bestMatch.siblingClientIds.length;
            } else {
                // It means the existing auto-capture is better somehow, theoretically unreachable without manual override, but still.
            }
        } else {
            numărIndisponibil++;
        }
    }
    
    offset += limit;
  }
  
  console.log("==========================================");
  console.log(" BACKFILL PIPELINE REPORT ");
  console.log("==========================================");
  console.log(`Total Unified Graph Vectors Checked: ${totalProcessedUniqueClients}`);
  console.log(`Manual Admin Overrides Avoided (Confidence 100): ${manualOverrides}`);
  console.log(`Clones Automatically Synced with Canonical PII: ${processedClients}`);
  console.log(`Orphaned "@lid" Nodes Remaining (Nu au nicio urmă E.164 istorică validă): ${numărIndisponibil}`);
  console.log("------------------------------------------");
  console.log("Breakdown by Canonical Source Extraction:");
  for (const [key, value] of Object.entries(sourceCounts)) {
     console.log(` - ${key}: ${value}`);
  }
  console.log("==========================================");
  
}

runBackfill().then(() => {
    console.log("Backfill Sweep Complete.");
    process.exit(0);
}).catch(e => {
    console.error("Backfill failed:", e);
    process.exit(1);
});
