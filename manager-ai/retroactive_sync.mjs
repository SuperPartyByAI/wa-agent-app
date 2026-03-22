/**
 * retroactive_sync.mjs
 * 
 * Procesează TOATE conversațiile active din vertex_sessions și extrage
 * datele evenimentelor în ai_client_events (cu Visual IDs 01A, 01B etc.)
 * 
 * Se poate rula oricând: este idempotent (nu duplică înregistrări).
 */
import dotenv from 'dotenv';
dotenv.config();
import { createClient } from '@supabase/supabase-js';
import { processWithVertexAI } from './src/vertex/vertexClient.mjs';

const vertexDb = createClient(process.env.VERTEX_SUPABASE_URL, process.env.VERTEX_SUPABASE_SERVICE_ROLE_KEY);
const mainDb   = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const BATCH_SIZE  = 5;    // câte sesiuni procesăm în paralel
const DELAY_MS    = 2000; // pauza între batches (ms) ca să nu supraîncărcăm API-ul

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function run() {
    console.log('=== RETROACTIVE EXTRACTION — ALL CLIENTS ===\n');

    // 1. Luăm toate sesiunile active cu numere de telefon reale
    const { data: sessions, error: sessErr } = await vertexDb
        .from('vertex_sessions')
        .select('phone_e164, updated_at')
        .eq('session_status', 'active')
        .order('updated_at', { ascending: false });

    if (sessErr) { console.error('DB Error:', sessErr.message); process.exit(1); }

    // Filtrăm doar numerele de telefon reale (E.164: încep cu +)
    const realPhones = [...new Set(
        (sessions || [])
            .map(s => s.phone_e164)
            .filter(p => p && p.startsWith('+') && p.length >= 10 && p.length <= 16)
    )];

    console.log(`Total sesiuni active: ${sessions.length}`);
    console.log(`Numere reale de procesat: ${realPhones.length}\n`);

    let processed = 0, skipped = 0, failed = 0;

    const triggerMessage = [
        'Bypass intern: Analizează INTEGRAL istoricul conversației noastre și extrage OBLIGATORIU fiecare petrecere/serviciu cerut.',
        'REGULI STRICTE — APLICĂ EXACT:',
        '1. PERSONAJE DIFERITE: Dacă clientul a cerut MAI MULTE PERSONAJE → apelează noteaza_petrecere de CÂTE ORI sunt personajele (UN apel per personaj). Exemplu: Elsa + Anna = 2 apeluri.',
        '2. SERVICII DIFERITE: Dacă clientul a cerut servicii DIFERITE (animație, candy bar, foto etc.) → apelează noteaza_petrecere SEPARAT pentru fiecare serviciu.',
        '3. CANTITATE = NR DE APELURI: Dacă clientul a cerut N persoane de același tip → faci N apeluri. Exemple: "2 animatori" = 2 apeluri; "2 DJ" = 2 apeluri.',
        '4. URSITOARE — REGULA SPECIALĂ: Ursitoarele vin CA PERSOANE FIZICE la eveniment. DACĂ în conversație clientul a ales sau menționat spectacolul de ursitoare → faci EXACT atâtea apeluri câte ursitoare sunt ÎN SPECTACOL: "3 ursitoare bune" = 3 apeluri cu role_title="Ursitoare"; "3 ursitoare bune + 1 rea" = 4 apeluri cu role_title="Ursitoare". NU FACE 1 SINGUR APEL cu cantitatea în detalii — GREȘIT! Fiecare ursitoare = 1 apel separat.',
        '5. NU pune mai multe persoane în același apel de funcție.',
        '6. Dacă nu ai date suficiente, apelează TOTUȘI cu ce ai disponibil.',
        'ACȚIONEAZĂ IMEDIAT cu funcțiile, nu răspunde verbal.'
    ].join(' ');

    // 2. Procesăm în batches
    for (let i = 0; i < realPhones.length; i += BATCH_SIZE) {
        const batch = realPhones.slice(i, i + BATCH_SIZE);
        
        console.log(`\n[Batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(realPhones.length / BATCH_SIZE)}] Procesez: ${batch.join(', ')}`);

        await Promise.allSettled(batch.map(async (phone) => {
            try {
                await processWithVertexAI(phone, triggerMessage, { isCrmLive: true, forceTools: true });
                processed++;
                console.log(`  ✅ ${phone}`);
            } catch (e) {
                failed++;
                console.error(`  ❌ ${phone}: ${e.message}`);
            }
        }));

        if (i + BATCH_SIZE < realPhones.length) {
            await sleep(DELAY_MS);
        }
    }

    console.log(`\n=== DONE ===`);
    console.log(`Procesate: ${processed} | Eșuate: ${failed} | Sărite: ${skipped}`);
    process.exit(0);
}

run();
