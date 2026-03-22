import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function test() {
    const { data, error } = await db.from("ai_knowledge_base").select("knowledge_key, policy_config").ilike("knowledge_key", "role_%");
    if (error) {
        console.error("Eroare:", error);
    } else {
        data.forEach(r => {
            const config = r.policy_config || {};
            const constraints = config.constraints?.must_collect_fields || [];
            console.log(r.knowledge_key, "->", constraints);
        });
    }
    process.exit(0);
}
test();
