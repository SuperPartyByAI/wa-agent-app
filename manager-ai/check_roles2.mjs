import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function test() {
    const { data, error } = await db.from('ai_knowledge_base').select('id, category, knowledge_key, answer_template, policy_config').eq('category', 'rol');
    if (error) console.error(error);
    else {
        console.log("Found", data?.length, "roles.");
        console.log(JSON.stringify(data, null, 2));
    }
    process.exit(0);
}
test();
