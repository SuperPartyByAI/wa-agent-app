import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env') });

const db = createClient(process.env.VERTEX_SUPABASE_URL, process.env.VERTEX_SUPABASE_SERVICE_ROLE_KEY);

const promptsToInsert = [
    {
        config_key: 'prompt_rule_event_context',
        config_value: `═══════════════════════════════════════\nEVENIMENTE DEJA NOTATE PENTRU ACEST CLIENT:\n═══════════════════════════════════════\n{EVENTS_LIST}\n\nREGULĂ CRITICĂ: Când clientul schimbă data, ora sau orice alt detaliu la o petrecere de mai sus, NU NOTA UNA NOUĂ! Folosește OBLIGATORIU tool-ul actualizeaza_petrecere folosind ID-ul petrecerii. Oferă-i clientului confirmarea actualizării.`
    },
    {
        config_key: 'prompt_continuation_anuleaza',
        config_value: `IMPORTANT: Clientul vrea să ANULEZE. Apelează ACUM anuleaza_petrecere cu event_id="{EVENT_ID}". NU confirma verbal, execută tool-ul.`
    },
    {
        config_key: 'prompt_continuation_reactivare',
        config_value: `IMPORTANT: Clientul vrea să REACTIVEZE. Apelează ACUM restaureaza_petrecere cu event_id="{EVENT_ID}". NU confirma verbal, execută tool-ul.`
    },
    {
        config_key: 'prompt_continuation_actualizare',
        config_value: `IMPORTANT: Clientul a cerut: "{USER_MSG}". Petrecerea are event_id="{EVENT_ID}". Apelează ACUM actualizeaza_petrecere cu event_id="{EVENT_ID}" și event_details cu câmpurile ce trebuie modificate. NU răspunde verbal fără tool!`
    },
    {
        config_key: 'prompt_continuation_default',
        config_value: `Continuă. Dacă trebuie altă acțiune, fă-o acum cu tool-ul corespunzător. Dacă ai terminat, confirmă clientului.`
    },
    {
        config_key: 'tool_desc_noteaza_petrecere',
        config_value: `Creează un serviciu nou pentru o petrecere a clientului. IMPORTANT: Toate serviciile din aceeași dată (ex: Animație + Ursitoare pe 20 Mai) se adaugă ca apeluri SEPARATE la noteaza_petrecere — sistemul le grupează automat sub același număr de eveniment (01A, 01B...). Fiecare apel are propria Ora de Început și Durată.`
    },
    {
        config_key: 'tool_desc_actualizeaza_petrecere',
        config_value: `Modifică detalii la un eveniment existent (dată, oră, locație, nr copii etc). Folosește event_id din cauta_petreceri.`
    },
    {
        config_key: 'tool_desc_anuleaza_petrecere',
        config_value: `Anulează un eveniment. Evenimentul RĂMÂNE în istoria clientului marcat ca ANULAT. Folosește când clientul spune că nu mai vrea petrecerea.`
    },
    {
        config_key: 'tool_desc_restaureaza_petrecere',
        config_value: `Restaurează un eveniment anulat. Folosește când clientul vrea să reactiveze o petrecere anulată anterior.`
    },
    {
        config_key: 'tool_desc_cauta_petreceri',
        config_value: `Caută toate petrecerile/evenimentele unui client (active, anulate, toate). APELEAZĂ ÎNTOTDEAUNA aceasta înainte de a actualiza sau anula, ca să ai ID-ul corect.`
    },
    {
        config_key: 'tool_desc_escaleaza',
        config_value: `Trimite conversația la un operator uman (când AI-ul nu poate rezolva sau clientul cere explicit un om).`
    }
];

async function run() {
    console.log("Incep inserarea manuala a 11 constante fragmentate in supabase DB...");
    for (const p of promptsToInsert) {
        const { data: existing } = await db.from("vertex_config").select("id").eq("config_key", p.config_key).eq("brand_key", "GLOBAL").maybeSingle();
        
        if (existing) {
             const { error } = await db.from("vertex_config").update({ config_value: p.config_value }).eq("id", existing.id);
             if (error) console.error(`Eroare Update ${p.config_key}:`, error.message);
             else console.log(`OK (Updated): ${p.config_key}`);
        } else {
             const { error } = await db.from("vertex_config").insert({ config_key: p.config_key, config_value: p.config_value, brand_key: "GLOBAL" });
             if (error) console.error(`Eroare Insert ${p.config_key}:`, error.message);
             else console.log(`OK (Inserted): ${p.config_key}`);
        }
    }
    console.log("Done.");
}
run();
