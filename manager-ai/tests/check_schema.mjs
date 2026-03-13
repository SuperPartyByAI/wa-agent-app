import dotenv from 'dotenv';
dotenv.config({ path: '../.env' }); // Adjusted to run from tests/
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function check() {
    const { data: conv } = await supabase.from('messages').select('*').limit(1);
    if (conv && conv.length > 0) {
        console.log("Messages shape:", Object.keys(conv[0]));
    } else {
        console.log("No messages found, cannot check shape.");
    }
    process.exit(0);
}
check();
