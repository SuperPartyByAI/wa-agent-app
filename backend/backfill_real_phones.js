require('dotenv').config();
const supabase = require('./supabase');
const { getClientGraphPhone } = require('./pii');

async function runBackfill() {
  console.log("🚀 Starting Canonical Real Phone Number Backfill...");

  // Get all clients that do not have a real_phone_confidence == 100 (admin overridden) 
  // or maybe just process all clients whose real_phone_e164 is null, 
  // but to be absolutely sure, let's process everyone except admin overrides.
  const { data: clients, error: fetchErr } = await supabase
    .from('clients')
    .select('id, real_phone_e164, real_phone_confidence');

  if (fetchErr) {
    console.error("Failed to fetch clients:", fetchErr);
    process.exit(1);
  }

  let totalProcessed = 0;
  let successCount = 0;
  let remainingNullCount = 0;
  let skippedOverrideCount = 0;

  console.log(`📡 Found ${clients.length} total clients to analyze.`);

  for (const client of clients) {
    totalProcessed++;

    if (client.real_phone_confidence === 100) {
      skippedOverrideCount++;
      continue; // Skip manual overrides
    }

    try {
      const bestMatch = await getClientGraphPhone(client.id);

      if (bestMatch) {
         // Update client if we found a match and it's better or equal to current confidence
         if (bestMatch.confidence >= (client.real_phone_confidence || 0)) {
           await supabase
             .from('clients')
             .update({
               real_phone_e164: bestMatch.e164,
               real_phone_source: bestMatch.source,
               real_phone_confidence: bestMatch.confidence,
               real_phone_updated_at: new Date().toISOString()
             })
             .eq('id', client.id);
             
           successCount++;
         } else {
           // We already had something better, keep it
           successCount++; 
         }
      } else {
         if (!client.real_phone_e164) {
           remainingNullCount++;
         } else {
           successCount++; // they already had one, but graph yielded null (rare, but maintain count)
         }
      }
    } catch (e) {
      console.error(`[Backfill] Error processing client ${client.id}:`, e.message);
    }
    
    // Slight delay to avoid hammering Supabase REST API limits
    await new Promise(res => setTimeout(res, 50)); 
  }

  console.log("\n=================================");
  console.log("🏁 Backfill Execution Complete");
  console.log("=================================");
  console.log(`Total Clients Processed   : ${totalProcessed}`);
  console.log(`Successfully Graph Liked  : ${successCount}`);
  console.log(`Clients Still Missing PII : ${remainingNullCount}`);
  console.log(`Skipped (Admin Override)  : ${skippedOverrideCount}`);
  console.log("=================================\n");
  
  process.exit(0);
}

runBackfill();
