import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '/Users/universparty/wa-web-launcher/wa-agent-app/backend/.env' });
const s = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
    const { data: convs, error } = await s.from('conversations')
        .select('id, last_message_at')
        .not('last_message_at', 'is', null)
        .limit(10);
    console.log("Conversatii cu date valide:", convs);
    if (error) console.log("Eroare:", error);
}
run();
