import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '/Users/universparty/wa-web-launcher/wa-agent-app/backend/.env' });
const s = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
    const { data: msgs } = await s.from('messages')
        .select('id, content, message_type, created_at')
        .order('created_at', { ascending: false })
        .limit(10);
    console.log(msgs);
}
run();
