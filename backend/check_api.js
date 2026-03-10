require("dotenv").config();

async function run() {
  const url = `${process.env.SUPABASE_URL}/rest/v1/v_inbox_summaries?select=*`;
  const url2 = `${process.env.SUPABASE_URL}/rest/v1/conversations?select=id,client_id,channel,status`;
  
  const headers = {
    "apikey": process.env.SUPABASE_SERVICE_ROLE_KEY,
    "Authorization": `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`
  };

  try {
    const r1 = await fetch(url, { headers });
    const d1 = await r1.json();
    console.log(`\n--- v_inbox_summaries (Total: ${d1.length}) ---`);
    d1.forEach(row => {
      console.log(`Conv: ${row.conversation_id} | Client: ${row.client_id} | Name: ${row.full_name} | Alias: ${row.public_alias}`);
    });

    const r2 = await fetch(url2, { headers });
    const d2 = await r2.json();
    console.log(`\n--- raw conversations (Total: ${d2.length}) ---`);
    
    // Calculate duplicates
    const counts = {};
    d2.forEach(c => {
      if (c.channel === 'whatsapp') {
        counts[c.client_id] = (counts[c.client_id] || 0) + 1;
      }
    });
    
    console.log("\n--- Client IDs with multiple WA conversations ---");
    let dupesFound = false;
    for (const [cId, count] of Object.entries(counts)) {
      if (count > 1) {
        dupesFound = true;
        console.log(`Client ${cId} has ${count} WhatsApp conversations:`);
        d2.filter(c => c.client_id === cId && c.channel === 'whatsapp').forEach(c => console.log(`  - ${c.id}`));
      }
    }
    if (!dupesFound) console.log("No duplicates found according to conversations table grouped by client_id.");

  } catch(e) {
    console.error("Fetch Error:", e);
  }
}
run();
