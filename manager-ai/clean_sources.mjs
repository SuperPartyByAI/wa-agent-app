import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } from './src/config/env.mjs';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function clean() {
    const { data, error } = await supabase.from('ai_knowledge_base').select('id, title, content, category, knowledge_key');
    if (error) {
        console.error("Eroare db:", error);
        return;
    }
    
    // Find sources (not native roles) that have "Rol:" in the title or "Detalii obligatorii de colectat" in content
    const targets = data.filter(d => 
        (d.category !== 'roles' && !d.knowledge_key?.startsWith('role_')) &&
        (
            (d.title && d.title.toLowerCase().startsWith('rol:')) ||
            (d.content && d.content.includes('Detalii obligatorii de colectat'))
        )
    );
    
    console.log(`Gasite ${targets.length} SURSE textuale care mimau Rolurile si trebuiesc sterse:`);
    
    for (const t of targets) {
        console.log(`- Stergem: [${t.title}] (ID: ${t.id})`);
        const { error: delErr } = await supabase.from('ai_knowledge_base').delete().eq('id', t.id);
        if (delErr) console.error("   ! Eroare stergere:", delErr);
        else console.log("   ✓ Sters cu succes din baza de date.");
    }
    
    const { data: remaining } = await supabase.from('ai_knowledge_base').select('title, knowledge_key').neq('category', 'roles');
    console.log("\nAu ramas in Surse doar urmatoarele documente legitime:");
    remaining.filter(r => !r.knowledge_key?.startsWith('role_')).forEach(r => console.log(`- ${r.title} (Key: ${r.knowledge_key})`));
}
clean();
