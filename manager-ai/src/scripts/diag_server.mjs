import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const mainDb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  console.log('--- DIAGNOSTIC SERVER ---');
  console.log('URL:', process.env.SUPABASE_URL);
  
  const { count: clients, error: errC } = await mainDb.from('clients').select('*', { count: 'exact', head: true });
  const { count: msgs, error: errM } = await mainDb.from('messages').select('*', { count: 'exact', head: true });
  const { count: notes, error: errN } = await mainDb.from('client_notebooks_v2').select('*', { count: 'exact', head: true });
  
  console.log('Clients count:', clients, errC ? errC.message : '');
  console.log('Messages count:', msgs, errM ? errM.message : '');
  console.log('Notebooks count:', notes, errN ? errN.message : '');

  // Verifică vizibilitatea tabelei client_notebooks_v2
  const { data: testWrite, error: errW } = await mainDb.from('client_notebooks_v2').upsert({
    phone_number: 'DIAGNOSTIC',
    wa_number: 'DIAGNOSTIC',
    clean_notebook: { test: 'ok' }
  });
  console.log('Test Write result:', errW ? errW.message : 'SUCCESS');
}
run();
