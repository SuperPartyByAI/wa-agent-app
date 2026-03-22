import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '/Users/universparty/wa-web-launcher/wa-agent-app/backend/.env' });

const s = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function checkLoop() {
  const { data, error } = await s
    .from('ai_client_events')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(10);
  
  if (error) console.error("EROARE DB:", error);
  console.log("=== ULTIMELE 10 EVENIMENTE CURENTE DIN DB ===");
  if (data) {
      data.forEach(row => {
        console.log(`[Event ${row.id}] [Client: ${row.client_id}] [Data: ${row.data_eveniment}] Details: ${JSON.stringify(row.servicii_cerute)}`);
      });
  }
}

checkLoop();
