import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function test() {
    const { data, error } = await db.from('ai_knowledge_base').select('*').eq('category', 'roles');
    if (error) console.error(error);
    else {
        console.log("Found", data?.length, "roles.");
        console.log(JSON.stringify(data.map(d => ({ title: d.title, content: d.content, metadata: d.metadata })), null, 2));
    }
    process.exit(0);
}
test();
