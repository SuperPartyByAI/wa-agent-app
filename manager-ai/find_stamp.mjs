import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '/Users/universparty/wa-web-launcher/wa-agent-app/backend/.env' });
const s = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
    const stamp = '2026-03-21T17:29:09.618946+00:00';
    console.log("Cautam Timestamp:", stamp);
    const { data: convs } = await s.from('conversations').select('id, client_id, last_message_at, updated_at').eq('last_message_at', stamp);
    console.log("Conversatii gasite cu acest last_message_at:", convs);
    
    // Caut si dupa updated_at sa vad daca acolo era de fapt si L-A PUS PE last_message_at?
    const { data: convs2 } = await s.from('conversations').select('id, client_id, last_message_at, updated_at').eq('updated_at', stamp);
    console.log("Conversatii gasite cu acest updated_at:", convs2);
}
run();
