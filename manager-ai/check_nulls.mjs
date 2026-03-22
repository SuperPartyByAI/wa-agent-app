import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function checkNullPhones() {
  const { data: clientsRaw } = await supabase.from('clients')
      .select('id, real_phone_e164, full_name, public_alias, avatar_url, brand_key')
      .is('real_phone_e164', null);
      
  console.log(`Found ${clientsRaw.length} clients with NULL real_phone_e164`);
  
  if (clientsRaw.length > 0) {
      console.log("Sample of null phone clients:", clientsRaw.slice(0, 10));
  }
}
checkNullPhones();
