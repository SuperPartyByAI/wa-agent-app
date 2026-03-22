require('dotenv').config({ path: '/Users/universparty/wa-web-launcher/wa-agent-app/manager-ai/.env' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.VERTEX_SUPABASE_URL, process.env.VERTEX_SUPABASE_SERVICE_ROLE_KEY);

async function run() {
    const { data: current, error: err1 } = await supabase.from('vertex_config').select('config_value').eq('config_key', 'system_prompt').single();
    if (err1) { console.error(err1); return; }
    
    let prompt = current.config_value;
    
    // Verificăm dacă am adăugat deja
    if (!prompt.includes('REGULI DE FORMATARE MESAJ')) {
        prompt += `\n\n═══════════════════════════════════\nREGULI DE FORMATARE MESAJ (EXTREM DE IMPORTANT):\n═══════════════════════════════════\n1. RĂSPUNSURI EXTREM DE SCURTE: Ești un om în carne și oase care răspunde pe WhatsApp, tastând rapid de pe telefon. Absolut nimeni nu scrie romane sau paragrafe lungi pe WhatsApp. Oferă replici de MAXIM 1-2 propoziții scurte per mesaj.\n2. FĂRĂ LISTE: Nu folosi niciodată bullet-points, liniuțe sau numerotări. Textul trebuie să curgă natural, ca într-o mesagerie text normală.\n3. PAS CU PAS: Dacă ai nevoie de 3 informații de la client (data, locația, personajul), NU le cere pe toate 3 deodată într-un mesaj lung! Cere-le DOAR pe rând. Răspunde-i scurt la ce a zis, apoi pune o singură întrebare.\n4. FĂRĂ FORMULĂRI ROBOTICE: Detașează-te de clișee precum "Sunt aici să vă ajut", "Vă stau la dispoziție gratuit cu informații", "Cu mare drag". Fii direct, rapid și extrem de concis. Clientul real reacționează prost la Customer Service excesiv de formal.`;
        
        const { error: err2 } = await supabase.from('vertex_config').update({ config_value: prompt }).eq('config_key', 'system_prompt');
        if (err2) console.error(err2);
        else console.log("✅ Reguli stricte de lungime și formatare WhatsApp injectate cu succes!");
    } else {
        console.log("ℹ️ Regulile erau deja adăugate.");
    }
}
run();
