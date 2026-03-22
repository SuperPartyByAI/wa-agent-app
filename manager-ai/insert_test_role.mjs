import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function test() {
    console.log("Inserăm rolul Animație în baza de date...");
    const payload = {
        knowledge_key: 'role_animatie_test',
        category: 'rol',
        answer_template: 'Animație Copii\nAcesta este un serviciu de Animație...',
        policy_config: {
            label: "Animație",
            triggers: { keywords: ["animator", "elsa", "spiderman", "batman", "party"] },
            constraints: { must_collect_fields: ["Vârsta Sărbătorit", "Orașul de Desfășurare"] }
        },
        active: true,
        approval_status: 'approved'
    };

    const { error } = await db.from("ai_knowledge_base").upsert(payload, { onConflict: 'knowledge_key' });
    if (error) {
        console.error("Eroare la inserare:", error);
    } else {
        console.log("Rolul de Animație a fost inserat cu Constrângerile: Vârsta Sărbătorit, Orașul de Desfășurare.");
    }
    process.exit(0);
}
test();
