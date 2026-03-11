require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY);

async function testStructuralInserts() {
  console.log("=== MOCKING NEW CLIENT INTERNAL INSERTS TO REVEAL THE HIDDEN VIOLATION ===");
  
  // 1. Mock creating the client itself
  console.log("1. MOCKING CLIENT INSERT...");
  const internalCode = 'CL-TEST' + Date.now();
  const { data: client, error: cErr } = await supabase.from('clients').insert({
      full_name: 'Epic-Test-01',
      source: 'whatsapp',
      brand_key: 'EPIC',
      public_alias: 'Epic-Test-01',
      internal_client_code: internalCode,
      alias_index: 99999
  }).select('id').single();

  if (cErr) {
     console.error("FATAL CLIENT INSERT ERROR:", JSON.stringify(cErr, null, 2));
     return;
  }
  
  const clientId = client.id;
  console.log("Client created successfully with ID:", clientId);

  // 2. Mock attaching identity links exactly as `create_client_identity_safe` does
  console.log("\n2. MOCKING IDENTITY LINK BINDINGS...");
  
  const testPhone = "40799999998";
  const links = [
      { client_id: clientId, brand_key: 'EPIC', identifier_type: 'msisdn', identifier_value: testPhone },
      { client_id: clientId, brand_key: 'EPIC', identifier_type: 'jid', identifier_value: `${testPhone}@s.whatsapp.net` }
  ];

  for (const link of links) {
      console.log(`Inserting link: ${link.identifier_type} = ${link.identifier_value}`);
      const { data, error } = await supabase.from('client_identity_links').insert(link);
      if (error) {
          console.error(`FATAL LINK ERROR FOR ${link.identifier_type}:`, JSON.stringify(error, null, 2));
      } else {
          console.log(`Link ${link.identifier_type} success.`);
      }
  }
  
  // Cleanup test
  await supabase.from('clients').delete().eq('id', clientId);
  console.log("\nTest complete.");
}

testStructuralInserts();
