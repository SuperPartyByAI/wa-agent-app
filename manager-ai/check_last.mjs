import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '/Users/universparty/wa-web-launcher/wa-agent-app/backend/.env' });
const s = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
async function run() {
const { data, error } = await s.from('conversations').select('id, updated_at, last_message_at').order('last_message_at', {ascending: false}).limit(5);
console.log(JSON.stringify(data, null, 2));
}
run();
