import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } from './src/config/env.mjs';
import { createClient } from '@supabase/supabase-js';

const mainSupa = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const vtxSupa = createClient(process.env.VERTEX_SUPABASE_URL || SUPABASE_URL, process.env.VERTEX_SUPABASE_SERVICE_ROLE_KEY || SUPABASE_SERVICE_ROLE_KEY);

const DEFAULT_PRICES = [
    { title: "Prețuri Animatori", content: "Pachet 1 ora = 250 RON\nPachet 2 ore = 400 RON\n(Include pictura pe fata, modelaj baloane, jocuri interactive)" },
    { title: "Prețuri Ursitoare", content: "Pachet Botez Standard = 400 RON\n(3 zane coregrafie, masina de fum gratuit, text personalizat, poze cu invitatii la sfarsit)" },
    { title: "Prețuri Mascote", content: "Inchiriere Mascota Minnie / Mickey = 250 RON / ora\nPachet animatie + mascota 2h = 500 RON" },
    { title: "Prețuri Baloane / Decoratiuni", content: "Arcada clasica din baloane = 350 RON\nBalon folie cifra cu Heliu = 50 RON bucata\nBaloane latex cu heliu = 10 RON bucata" },
    { title: "Prețuri Popcorn", content: "Inchiriere masina de Popcorn cu personal inclus = 250 RON pentru primele 2 ore" },
    { title: "Prețuri Vată de Zahăr", content: "Inchiriere masina vata de zahar pe bat = 250 RON pentru 2 ore" },
    { title: "Prețuri Cabina Foto / Oglinda", content: "Pachet Oglinda Magica 2h = 600 RON\nPachet Oglinda 4h = 1000 RON\nInclude poze printate nelimitat magnetice si recuzita." }
];

async function run() {
    try {
        console.log("Extragem brandurile (QR-urile) active din whatsapp_sessions...");
        const { data: sessions, error: sErr } = await mainSupa.from('whatsapp_sessions').select('brand_key').eq('status', 'CONNECTED');
        if (sErr) throw sErr;
        
        let brands = [...new Set((sessions || []).map((s) => s.brand_key).filter(Boolean))];
        
        if (brands.length === 0) {
            console.log("Nu am gasit branduri CONECTATE. Incercam din tabelul ai_brand_aliases...");
            const { data: aliases } = await mainSupa.from('ai_brand_aliases').select('brand_key');
            brands = [...new Set((aliases || []).map((a) => a.brand_key))];
        }
        
        if (brands.length === 0) {
            brands = ['BRAND_ANIMATOPIA', 'BRAND_DIVERTIX', 'BRAND_KASSYA', 'BRAND_PINKY', 'BRAND_GALAXY', 'BRAND_EPIC'];
            console.log("Folosim branduri fallback:", brands);
        } else {
            console.log(`Gasite ${brands.length} branduri: ${brands.join(', ')}`);
        }

        let totalInserted = 0;
        
        for (const brand of brands) {
            console.log(`\nProcesare Brand [${brand}]:`);
            
            const { data: existing } = await vtxSupa.from('vertex_sources')
                                        .select('id, title')
                                        .eq('brand_key', brand)
                                        .eq('category', 'servicii');
            
            if (existing && existing.length > 0) {
                console.log(`  -> Brandul are deja ${existing.length} surse de servicii. Salt pentru a preveni dubluri.`);
                continue;
            }
            
            const insertPayload = DEFAULT_PRICES.map((pkg) => ({
                brand_key: brand,
                category: 'servicii',
                title: pkg.title,
                content: pkg.content
            }));
            
            const { error: insErr } = await vtxSupa.from('vertex_sources').insert(insertPayload);
            if (insErr) {
                console.error(`  ! Eroare insert la ${brand}:`, insErr);
            } else {
                console.log(`  -> Inserat cu succes ${insertPayload.length} surse atomice.`);
                totalInserted += insertPayload.length;
            }
        }
        
        console.log(`\n[FINALIZAT] Am inserat in total ${totalInserted} de dosare cu prețuri pentru QR-uri!`);
    } catch (e) {
        console.error("Eroare critica:", e);
    }
}
run();
