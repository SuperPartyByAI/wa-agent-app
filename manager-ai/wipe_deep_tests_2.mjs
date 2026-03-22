import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function deepClean2() {
  console.log("Fetching simulated test clients by full_name and broad 070 prefixes...");
  
  const { data: c1 } = await supabase.from('clients').select('id, full_name, real_phone_e164').ilike('full_name', '%Test%');
  const { data: c2 } = await supabase.from('clients').select('id, full_name, real_phone_e164').ilike('full_name', '%Simulat%');
  const { data: c3 } = await supabase.from('clients').select('id, full_name, real_phone_e164').ilike('real_phone_e164', '+4070%');
  const { data: c4 } = await supabase.from('clients').select('id, full_name, real_phone_e164').ilike('real_phone_e164', '+407%'); // just in case there are +4040, wait, no, +4070
    
  // De-duplicate
  const allTests = [];
  const seenIds = new Set();
  
  // We only want the suspicious +4070 numbers, we don't want to wipe actual +407 clients (which are standard romanian numbers).
  // Romanian numbers are +407 followed by 8 digits.
  // We'll trust c1, c2, and c3.
  for (const c of [...(c1||[]), ...(c2||[]), ...(c3||[])]) {
      if (!seenIds.has(c.id)) {
          seenIds.add(c.id);
          allTests.push(c);
      }
  }
  
  console.log(`Found ${allTests.length} deep-test clients remaining.`);
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

deepClean2();
