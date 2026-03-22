import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '/Users/universparty/wa-web-launcher/wa-agent-app/manager-ai/.env' });

const vertexDb = createClient(process.env.VERTEX_SUPABASE_URL, process.env.VERTEX_SUPABASE_SERVICE_ROLE_KEY);

async function run() {
    const newContent = `Serviciu: Animație pentru copii (animatori, mascote, personaje).
Tag-uri: animatie, animatori, mascote, elsa, spiderman, frozen, personaje
Detalii obligatorii de colectat: Data Evenimentului, Ora de Început, Locația, Personajul Dorit, Număr Copii, Durata (ore), Nume Sărbătorit, Vârstă Sărbătorit, Data Nașterii Sărbătorit, Metodă de Plată (Cash/Card), Situație Încasare.

REGULĂ CRITICĂ PENTRU EXTRAGERE PERSONAJE:
1. FIECARE PERSONAJ = UN ROL SEPARAT.
2. Dacă clientul cere MAI MULTE personaje (ex: "Spiderman și Elsa"), TREBUIE să apelezi \`noteaza_petrecere\` de MAI MULTE ORI CONSECUTIV (o dată pentru Elsa, a doua oară pentru Spiderman). Nu pune "Spiderman și Elsa" în același apel!
3. Formatează numele personajului îngrijit, cu majuscule (ex: "Mickey Mouse", "Spiderman").`;

    const { error } = await vertexDb.from('vertex_sources')
        .update({ content: newContent, updated_at: new Date().toISOString() })
        .eq('title', 'Rol: Animație')
        .eq('category', 'rol');
    
    if (error) {
        console.error("Error updating", error);
    } else {
        console.log("Success updating Animație role rules!");
    }
}
run();
