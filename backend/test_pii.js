const supabase = require('./supabase');

async function run() {
  const clientId = '84012229-c561-474d-8815-ba1d615c1b7b';
  console.log('Testing Graph for Client ID:', clientId);
  
  const { data: directLinks } = await supabase.from('client_identity_links').select('*').eq('client_id', clientId);
  console.log('Direct Links:', directLinks);
  
  const identifierValues = directLinks.map(l => l.identifier_value);
  const { data: crossLinks } = await supabase.from('client_identity_links').select('*').in('identifier_value', identifierValues);
  console.log('Cross Links:', crossLinks);
  
  const siblingClientIds = Array.from(new Set((crossLinks || []).map(l => l.client_id)));
  const { data: entireFootprint } = await supabase.from('client_identity_links').select('*').in('client_id', siblingClientIds);
  console.log('Entire Footprint:', entireFootprint);
}
run();
