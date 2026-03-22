import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '/Users/universparty/wa-web-launcher/wa-agent-app/backend/.env' });
const s = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
    const { data } = await s.from('clients').select('public_alias').eq('id', '8306d59a-204b-4e45-aae3-30430a859ca2');
    console.log("Client alias:", data);
}
run();
