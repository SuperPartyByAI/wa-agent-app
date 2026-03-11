require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY);

async function testRPC() {
  console.log("=== TESTING NATIVE POSTGRES RPC ===");
  const testPhone = "40799999999";
  const rpcPayload = {
      p_brand_key: "EPIC",
      p_alias_prefix: "Epic",
      p_identifiers: [
         { type: 'msisdn', value: testPhone },
         { type: 'jid', value: `${testPhone}@s.whatsapp.net` }
      ],
      p_source: 'whatsapp'
  };

  console.log("Sending payload:", JSON.stringify(rpcPayload, null, 2));
  
  const { data, error } = await supabase.rpc('create_client_identity_safe', rpcPayload);
  
  if (error) {
      console.error("\n[RPC FATAL ERROR]:", JSON.stringify(error, null, 2));
  } else {
      console.log("\n[RPC SUCCESS]:", JSON.stringify(data, null, 2));
  }
}

testRPC();
