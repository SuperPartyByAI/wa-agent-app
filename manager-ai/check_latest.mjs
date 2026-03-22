import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '/Users/universparty/wa-web-launcher/wa-agent-app/manager-ai/.env' });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function check() {
    console.log("== MSG = 'da' ==");
    const { data: messages, error: errorMessages } = await supabase
        .from('messages')
        .select('*')
        .eq('conversation_id', '3119205d-dbbf-4787-bdad-3129fe2eeebc')
        .order('created_at', { ascending: false })
        .limit(10);

    if (errorMessages) console.error(errorMessages);
    else console.log("MESSAGES:", messages);
}
check();
