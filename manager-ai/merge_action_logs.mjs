import dotenv from 'dotenv';
dotenv.config();
import { createClient } from '@supabase/supabase-js';

const db = createClient(process.env.VERTEX_SUPABASE_URL, process.env.VERTEX_SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  console.log('=== FIXING LEFTOVER DUPLICATES ===');
  const { data: sessions } = await db.from('vertex_sessions')
    .select('id, phone_e164')
    .eq('session_status', 'active')
    .order('created_at', { ascending: true });
  
  const phoneMap = {};
  for (const s of sessions) {
      if (!phoneMap[s.phone_e164]) phoneMap[s.phone_e164] = [];
      phoneMap[s.phone_e164].push(s.id);
  }
  
  for (const [phone, ids] of Object.entries(phoneMap)) {
      if (ids.length > 1) {
          const mainSessionId = ids[0];
          const duplicates = ids.slice(1);
          console.log(`Phone ${phone} has ${ids.length} sessions. Main: ${mainSessionId}. Merging: ${duplicates.length}`);
          
          for (const dupId of duplicates) {
              await db.from('vertex_action_logs').update({ session_id: mainSessionId }).eq('session_id', dupId);
              await db.from('vertex_messages').update({ session_id: mainSessionId }).eq('session_id', dupId);
              await db.from('vertex_sessions').delete().eq('id', dupId);
          }
      }
  }
  console.log('=== DONE ===');
  process.exit(0);
}
run();
