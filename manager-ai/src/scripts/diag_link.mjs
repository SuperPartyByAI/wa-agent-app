import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const mainDb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  console.log('--- DIAGNOSTIC LINK CLIENT-CONV ---');
  
  const { data: convs, error: errC } = await mainDb.from('conversations').select('id, client_id').limit(10);
  console.log('Sample client_ids in conversations:', convs);

  if (convs && convs.length > 0) {
    for (const c of convs) {
       if (!c.client_id) continue;
       const { data: client, error: errL } = await mainDb.from('clients').select('id, real_phone_e164').eq('id', c.client_id).single();
       console.log(`Conv ${c.id} -> Client ${c.client_id}:`, client ? client.real_phone_e164 : 'NOT FOUND', errL ? errL.message : '');
    }
  }

  const { count: clientsWithPhones } = await mainDb.from('clients').select('*', { count: 'exact', head: true }).not('real_phone_e164', 'is', null).neq('real_phone_e164', '+0');
  console.log('Clients with valid phones:', clientsWithPhones);
}
run();
