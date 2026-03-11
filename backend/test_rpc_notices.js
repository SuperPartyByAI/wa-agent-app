require('dotenv').config();
const { Client } = require('pg');

async function debugNotices() {
  const pwd = process.env.SUPABASE_DB_PASSWORD;
  const connectionString = `postgres://postgres.qntpnyhwnhngkicxozss:${pwd}@aws-0-eu-central-1.pooler.supabase.com:5432/postgres`;
  const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
  
  await client.connect();
  
  client.on('notice', msg => {
      console.log("[PG NOTICE CAUGHT]:", msg.message);
  });

  console.log("=== EXECUTING TEST RPC WITH NOTICE CAPTURE ===");
  try {
     const testPhone = "40799999999";
     const payload = {
        p_brand_key: "EPIC",
        p_alias_prefix: "Epic",
        p_identifiers: [
           { type: 'msisdn', value: testPhone },
           { type: 'jid', value: `${testPhone}@s.whatsapp.net` }
        ],
        p_source: 'whatsapp'
     };
     
     await client.query("SELECT * FROM create_client_identity_safe($1, $2, $3, $4)", [
         payload.p_brand_key, JSON.stringify(payload.p_identifiers), payload.p_source, payload.p_alias_prefix
     ]);
  } catch(e) {
      console.log("[FINAL ERROR STATE]:", e.message);
  } finally {
      await client.end();
  }
}

debugNotices();
