import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function test() {
    const { data, error } = await db.from("ai_knowledge_base").select("category, knowledge_key, answer_template");
    if (error) {
        console.error("Eroare:", error);
    } else {
        const cats = [...new Set(data.map(d => d.category))];
        console.log("Categorii distincte in DB:", cats);
        const roles = data.filter(d => d.knowledge_key?.startsWith('role_'));
        console.log("Roluri salvate sub altă categorie:", roles.length);
        console.log(roles.map(r => r.category + " -> " + r.knowledge_key));
    }
    process.exit(0);
}
test();
