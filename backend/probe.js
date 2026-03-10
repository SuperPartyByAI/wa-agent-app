const supabase = require('./supabase');

async function run() {
  console.log("--- DB AUDIT PROBE ---");
  
  // Check types in links
  let { data: linkTypes } = await supabase.from('client_identity_links').select('identifier_type');
  let types = [...new Set((linkTypes||[]).map(l => l.identifier_type))];
  console.log("Found identifier_types in graph:", types);
  
  // Check clients phone
  let { count: cPhoneCount } = await supabase.from('clients').select('*', { count: 'exact', head: true }).not('phone', 'is', null);
  console.log("Clients with native CRM 'phone' populated:", cPhoneCount);
  
  // Check client sources
  let { data: cSources } = await supabase.from('clients').select('source');
  let sources = [...new Set((cSources||[]).map(c => c.source))];
  console.log("Found client sources:", sources);

  let { count: aiCount } = await supabase.from('ai_extractions').select('*', { count: 'exact', head: true });
  console.log("AI Extractions count:", aiCount);
}

run().catch(console.error);
