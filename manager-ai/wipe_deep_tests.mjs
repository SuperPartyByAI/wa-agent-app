import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function deepClean() {
  console.log("Fetching simulated test clients by alias and irregular numbers...");
  
  const { data: c1 } = await supabase.from('clients')
    .select('id, public_alias, real_phone_e164')
    .ilike('public_alias', '%Test%');
    
  const { data: c2 } = await supabase.from('clients')
    .select('id, public_alias, real_phone_e164')
    .ilike('public_alias', '%Simulat%');
    
  // Also any names exactly equal to numbers or starting with weird prefixes like +404, +409 if any exist that we want to kill
  const { data: c3 } = await supabase.from('clients')
    .select('id, public_alias, real_phone_e164')
    .ilike('real_phone_e164', '+404%');
    
  const { data: c4 } = await supabase.from('clients')
    .select('id, public_alias, real_phone_e164')
    .ilike('real_phone_e164', '+409%');
    
  // De-duplicate
  const allTests = [];
  const seenIds = new Set();
  
  for (const c of [...(c1||[]), ...(c2||[]), ...(c3||[]), ...(c4||[])]) {
      if (!seenIds.has(c.id)) {
          seenIds.add(c.id);
          allTests.push(c);
      }
  }
  
  console.log(`Found ${allTests.length} deep-test clients.`);
  if (allTests.length === 0) return;
  
  const clientIds = allTests.map(c => c.id);
  
  const { data: convs } = await supabase.from('conversations').select('id').in('client_id', clientIds);
  const convIds = (convs || []).map(c => c.id);
  
  if (convIds.length > 0) {
      console.log(`Found ${convIds.length} dependent conversations... wiping...`);
      await supabase.from('messages').delete().in('conversation_id', convIds);
      await supabase.from('ai_reply_decisions').delete().in('conversation_id', convIds);
  }
  
  console.log("Wiping drafting and memory...");
  await supabase.from('party_drafts').delete().in('client_id', clientIds);
  await supabase.from('ai_client_notebooks').delete().in('client_id', clientIds);
  
  if (convIds.length > 0) {
      await supabase.from('conversations').delete().in('client_id', clientIds);
  }
  
  console.log("Wiping clients...");
  const { error: fErr } = await supabase.from('clients').delete().in('id', clientIds);
  
  if (fErr) console.error("Final Error:", fErr);
  else console.log(`✅ Successfully wiped ${allTests.length} E2E/Simulated test client data!`);
}

deepClean();
