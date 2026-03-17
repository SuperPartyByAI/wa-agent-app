import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function clean() {
  console.log("Fetching test clients...");
  const { data: c1 } = await supabase.from('clients').select('id').like('real_phone_e164', '%407000%');
  const { data: c2 } = await supabase.from('clients').select('id').like('real_phone_e164', '%407999%');
  
  const allTests = [...(c1 || []), ...(c2 || [])];
  console.log(`Found ${allTests.length} test clients.`);
  
  if (allTests.length === 0) return;
  
  const clientIds = allTests.map(c => c.id);
  
  // 1. Get all conversation IDs for these clients
  const { data: convs } = await supabase.from('conversations').select('id').in('client_id', clientIds);
  const convIds = (convs || []).map(c => c.id);
  
  if (convIds.length > 0) {
      console.log(`Found ${convIds.length} conversations to wipe.`);
      
      // 2. Delete messages
      console.log("Deleting messages...");
      await supabase.from('messages').delete().in('conversation_id', convIds);
      
      // 3. Delete AI Reply Decisions
      console.log("Deleting AI reply decisions...");
      await supabase.from('ai_reply_decisions').delete().in('conversation_id', convIds);
  }
  
  // 4. Delete Party Drafts
  console.log("Deleting party drafts...");
  await supabase.from('party_drafts').delete().in('client_id', clientIds);
  
  // 5. Delete Notebook Entries
  console.log("Deleting notebook entries...");
  await supabase.from('ai_client_notebooks').delete().in('client_id', clientIds);
  
  // 6. Delete Conversations
  if (convIds.length > 0) {
      console.log("Deleting conversations...");
      await supabase.from('conversations').delete().in('client_id', clientIds);
  }
  
  // 7. Finally Delete Clients
  console.log("Deleting clients...");
  const { error: fErr } = await supabase.from('clients').delete().in('id', clientIds);
  
  if (fErr) console.error("Final Error:", fErr);
  else console.log("✅ Successfully wiped all test client data!");
}

clean();
