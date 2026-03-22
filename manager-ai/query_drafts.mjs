import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
    const { data } = await supabase.from('ai_event_drafts').select('id, draft_type, structured_data_json').order('updated_at', { ascending: false }).limit(5);
    console.log(JSON.stringify(data, null, 2));
}
run();
