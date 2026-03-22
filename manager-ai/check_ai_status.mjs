import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function checkConfig() {
  const { data: cfg } = await supabase.from('vertex_config').select('*').eq('config_key', 'ai_enabled').single();
  console.log('LIVE AI STATUS IN DB:', cfg);
  
  // also check if manager-ai-api log had any "Trimit pe WhatsApp" print using bash?
}
checkConfig();
