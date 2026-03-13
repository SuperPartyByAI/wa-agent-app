import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function check() {
  const { data: pkgs, error } = await supabase.from('ai_packages_animatori').select('*');
  if (error) console.error('Error fetching packages:', error);
  else console.log('Packages:', JSON.stringify(pkgs, null, 2));

  const { data: kb, error: kbErr } = await supabase.from('ai_knowledge_base').select('domain, intent, metadata').eq('domain', 'pricing');
  if (kbErr) console.error('Error fetching KB:', kbErr);
  else console.log('KB Pricing:', JSON.stringify(kb, null, 2));
}

check();
