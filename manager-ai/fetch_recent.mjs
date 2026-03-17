import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function run() {
    const { data, error } = await supabase.from('messages').select('sender_type,content,created_at').order('created_at', { ascending: false }).limit(6);
    if(error) console.error(error);
    else console.log(JSON.stringify(data, null, 2));
}
run();
