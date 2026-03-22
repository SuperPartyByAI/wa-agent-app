import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '/Users/universparty/wa-web-launcher/wa-agent-app/backend/.env' });
const s = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
    const { data } = await s.from('conversations').select('id, client_id, last_message_at').order('last_message_at', { ascending: false }).limit(10);
    console.log("Top conversations:", data);
}
run();
