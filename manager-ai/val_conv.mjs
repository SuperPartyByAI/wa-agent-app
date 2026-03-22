import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '/Users/universparty/wa-web-launcher/wa-agent-app/backend/.env' });
const s = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
async function run() {
const { data, error } = await s.from('conversations').select('id, messages(created_at, content)').eq('client_id', '67dcf4ae-e682-426a-b7de-1fef0097a3ae');
console.log(JSON.stringify(data, null, 2));
}
run();
