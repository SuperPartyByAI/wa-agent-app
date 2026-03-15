import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
(async () => {
  const { data, error } = await supabase.from('ai_knowledge_base').select('*').limit(1);
  if (error) console.error(error);
  console.log(JSON.stringify(data, null, 2));
})();
