import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '/Users/universparty/wa-web-launcher/wa-agent-app/backend/.env' });
const s = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
async function run() {
  const cId = 'c987b288-f3b7-41d3-b899-38bde0ab4235';
  const { data: msgs, error: msgsErr } = await s.from('messages').select('created_at').eq('conversation_id', cId).order('created_at', { ascending: false }).limit(1);
  console.log("msgs:", msgs, "err:", msgsErr);
  if (msgs && msgs.length > 0) {
    const { data: upd, error: updErr } = await s.from('conversations').update({ last_message_at: msgs[0].created_at }).eq('id', cId).select();
    console.log("Updated data:", upd, "err:", updErr);
  }
}
run();
