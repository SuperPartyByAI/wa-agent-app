import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { processWithVertexAI } from './src/vertex/vertexClient.mjs';

dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function run() {
    console.log("Începem extracția retroactivă a informațiilor din conversații...");
    
    // Extragem ultimele 40 conversatii
    const { data: convs, error } = await supabase.from('conversations')
        .select('*, clients!inner(real_phone_e164)')
        .order('updated_at', { ascending: false })
        .limit(40);

    if (error) { console.error("Error fetching convs", error); return; }

    for (const conv of convs) {
        const phone = conv.clients?.real_phone_e164 || conv.client_phone;
        if (!phone) continue;

        // Verificăm dacă are deja draft
        const { data: drafts } = await supabase.from('ai_event_drafts').select('id').eq('conversation_id', conv.id);
        if (drafts && drafts.length > 0) {
            console.log(`[Skip] Conversația ${conv.id} (${phone}) are deja panoul completat.`);
            continue;
        }

        // Luăm istoricul
        const { data: messages } = await supabase.from('messages')
            .select('content, sender_type')
            .eq('conversation_id', conv.id)
            .order('created_at', { ascending: true })
            .limit(30);

        if (!messages || messages.length < 2) continue; // Skip clienții fără prea multe mesaje

        const combinedMessage = messages.map(m => `[${m.sender_type.toUpperCase()}]: ${m.content}`).join('\n');
        
        console.log(`\n---------------------------------`);
        console.log(`🚀 Extrag date pt: ${phone}...`);
        
        try {
            const promptWrapper = `Te rog să extragi STRICT datele și detaliile din următoarea conversație, fie ele furnizate de AI, fie re-trimise de operator. Nu răspunde textual, doar acționează!\n\nDACĂ conține date pentru o petrecere/eveniment, APELEAZĂ imediat funcția 'noteaza_petrecere' folosind TOATE detaliile găsite acolo (Locatie, Data, Nume, Personaj, etc). DACĂ găsești mai multe personaje diferite într-un sistem de mai multe servicii dorite separat, cheami funcția de mai multe ori. Aici este istoricul:\n\n${combinedMessage}`;
            
            const result = await processWithVertexAI(phone, promptWrapper, { forceTools: true });
            
            console.log(`✅ [Vertex] Finished. Reply: ${result.reply?.substring(0, 60)}...`);
            
            if (result.functionCalls && result.functionCalls.length > 0) {
                 console.log(`🔧 Funcții apelate: ${result.functionCalls.map(f => f.name).join(', ')}`);
                 
                 for (const fc of result.functionCalls) {
                     if (fc.name === 'noteaza_petrecere' && fc.args) {
                         const draftData = {
                             conversation_id: conv.id,
                             client_id: conv.client_id,
                             draft_type: fc.args.role_title || 'Animație',
                             structured_data_json: fc.args.event_details || {},
                             updated_at: new Date().toISOString()
                         };
                         const { error: insertErr } = await supabase.from('ai_event_drafts').insert(draftData);
                         if (insertErr) console.error(`❌ [Eroare Salvare Draft]`, insertErr.message);
                         else console.log(`📝 [Succes] Formularul a apărut pentru ${phone} pe panou!`);
                     }
                 }
            } else {
                 console.log(`❌ Nicio funcție apelată. Conversația nu are date clare.`);
            }
        } catch (err) {
            console.error(`[Eroare] ${err.message}`);
        }
        await sleep(1500); // 1.5s delay
    }
    console.log("\n✅ Extracția a fost finalizată pentru toți clienții.");
}

run();
