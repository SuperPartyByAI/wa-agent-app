/**
 * backfill_notebooks_v3.mjs
 * 
 * V3 Optimizată & Robustă: 
 * - Pornește de la Tabela de CLIENȚI.
 * - Salvează TRANSCRIPT-ul complet pentru vizualizare în dashboard.
 * - Folosește Gemini 2.5 Flash-Lite.
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

const mainDb = createClient(SUPABASE_URL, SUPABASE_KEY);

const SESSION_MAP = {
    'wa_138176ff': 'SUPERPARTY',
    'wa_4cb585dd': 'SUPERPARTY',
    'wa_live_006': 'DIVERTIX',
    'wa_9352c113': 'PINKY',
    'wa_b2e48a45': 'KASSYA',
    'wa_b5743b6a': 'EPIC',
    'wa_b8d8b5c8': 'GALAXY',
    'wa_b46e5e75': 'WOWPARTY'
};

const EXTRACT_MODEL = 'gemini-2.5-flash-lite';

async function callGeminiExtractJSON(transcript) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${EXTRACT_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
    const body = {
        contents: [{ role: 'user', parts: [{ text: `CONVERSAȚIE:\n${transcript}` }] }],
        systemInstruction: {
            role: 'system',
            parts: [{ text: `Ești un sistem de extracție date. Analizezi discuția și extragi:
data_eveniment, ora_eveniment, serviciu, personaj, locatie, pret_discutat, nr_copii, varsta_copil, metoda_plata, observatii.
Returnează EXCLUSIV JSON valid.` }]
        },
        generationConfig: { temperature: 0.0, maxOutputTokens: 1024, responseMimeType: 'application/json' }
    };

    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        if (!res.ok) {
            console.error(`  ⚠️ Gemini API Error: ${res.status} ${res.statusText}`);
            return null;
        }
        const data = await res.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
        return JSON.parse(text);
    } catch (e) {
        console.error(`  ⚠️ Gemini JSON Error: ${e.message}`);
        return null;
    }
}

async function runV3() {
    console.log('🚀 Pornire Backfill V3 (Robust & Transcript)...');
    console.log(`📡 DB: ${SUPABASE_URL}`);

    // 1. Luăm toți clienții care AU un număr de telefon valid
    const { data: clients, error: clientErr } = await mainDb
        .from('clients')
        .select('id, real_phone_e164, brand_key')
        .not('real_phone_e164', 'is', null)
        .neq('real_phone_e164', '+0')
        .order('created_at', { ascending: false });

    if (clientErr) {
        console.error('❌ Eroare Table Clients:', clientErr.message);
        return;
    }

    console.log(`📊 Găsit ${clients.length} clienți cu telefon valid.`);

    let successCount = 0;

    for (const [idx, client] of clients.entries()) {
        const phone = client.real_phone_e164;
        
        // 2. Găsim conversațiile acestui client (toate)
        const { data: convs } = await mainDb
            .from('conversations')
            .select('id, session_id, brand_key')
            .eq('client_id', client.id);

        if (!convs || convs.length === 0) {
            // Nu logăm skip-uri silențioase pentru a nu polua terminalul
            continue;
        }

        console.log(`[${idx + 1}/${clients.length}] Procesare ${phone} (${convs.length} convs)...`);

        for (const conv of convs) {
            const brandKey = SESSION_MAP[conv.session_id] || conv.brand_key || client.brand_key || 'GLOBAL';
            
            // 3. Extragem mesajele (ultimele 100)
            const { data: msgs } = await mainDb
                .from('messages')
                .select('sender_type, content, created_at')
                .eq('conversation_id', conv.id)
                .order('created_at', { ascending: false })
                .limit(100);

            if (!msgs || msgs.length === 0) continue;

            const transcript = msgs.reverse()
                .map(m => `[${m.sender_type === 'agent' ? 'Echipă' : 'Client'}] (${new Date(m.created_at).toLocaleString('ro-RO')}): ${m.content || ''}`)
                .join('\n');

            const extracted = await callGeminiExtractJSON(transcript);
            
            // Chiar dacă extracția e goală, salvăm transcriptul dacă avem mesaje
            const cleanData = extracted || {};

            // 4. Upsert în client_notebooks_v2
            const { error: upsertErr } = await mainDb
                .from('client_notebooks_v2')
                .upsert({
                    phone_number: phone,
                    wa_number: brandKey,
                    brand_key: brandKey,
                    clean_notebook: cleanData,
                    last_transcript: transcript,
                    summary_updated_at: new Date().toISOString()
                }, { onConflict: 'phone_number,wa_number' });

            if (upsertErr) {
                console.error(`  ❌ Upsert Fail for ${phone}:`, upsertErr.message);
            } else {
                console.log(`  ✅ Succes [${brandKey}]: ${msgs.length} mesaje procesate.`);
                successCount++;
            }

            // Rate limit guard (Gemini 2.5 e generos dar mai bine preventiv)
            await new Promise(r => setTimeout(r, 200));
        }
    }

    console.log(`🏁 Backfill V3 Finalizat. Clienți salvați: ${successCount}`);
}

runV3();
