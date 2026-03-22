/**
 * backfill_notebooks.mjs
 * 
 * Script de sincronizare istoric: citește toate conversațiile vechi din vertex_messages,
 * extrage datele structurate via Gemini și populează client_notebooks_v2.
 * 
 * Sincronizează TRECUTUL cu sistemul nou de Notebook Persistent.
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const VERTEX_SUPABASE_URL = process.env.VERTEX_SUPABASE_URL;
const VERTEX_SUPABASE_KEY = process.env.VERTEX_SUPABASE_SERVICE_ROLE_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

const mainDb = createClient(SUPABASE_URL, SUPABASE_KEY);
const vertexDb = createClient(VERTEX_SUPABASE_URL, VERTEX_SUPABASE_KEY);

const EXTRACT_MODEL = 'gemini-2.0-flash-lite';

async function callGeminiExtractJSON(transcript) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${EXTRACT_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
    const body = {
        contents: [{ role: 'user', parts: [{ text: `CONVERSAȚIE:\n${transcript}` }] }],
        systemInstruction: {
            role: 'system',
            parts: [{ text: `Ești un sistem de extracție date pentru Superparty.
Analizezi conversația și returnezi DOAR un JSON valid cu câmpurile găsite.
Câmpuri: data_eveniment, ora_eveniment, serviciu, personaj, locatie, pret_discutat, nr_copii, varsta_copil, metoda_plata, observatii.
Returnează EXCLUSIV JSON.` }]
        },
        generationConfig: { temperature: 0.0, maxOutputTokens: 512, responseMimeType: 'application/json' }
    };

    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        if (!res.ok) return null;
        const data = await res.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
        return JSON.parse(text);
    } catch {
        return null;
    }
}

async function runBackfill() {
    console.log('🚀 Pornire Backfill Notebooks...');

    // 1. Găsim perechile unice (telefon, brand) care au mesaje
    const { data: pairs, error: pairsErr } = await vertexDb
        .from('vertex_messages')
        .select('client_phone, brand_key')
        .not('client_phone', 'is', null)
        .neq('client_phone', 'simulator')
        .order('created_at', { ascending: false });

    if (pairsErr) {
        console.error('❌ Eroare la citirea perechilor:', pairsErr.message);
        return;
    }

    // Deduplicare manuală (Supabase select distinct e limitat)
    const uniquePairs = [];
    const seen = new Set();
    for (const p of pairs) {
        const key = `${p.client_phone}|${p.brand_key}`;
        if (!seen.has(key)) {
            uniquePairs.push(p);
            seen.add(key);
        }
    }

    console.log(`📊 Găsit ${uniquePairs.length} clienți unici pentru procesare.`);

    for (const [idx, pair] of uniquePairs.entries()) {
        const { client_phone, brand_key } = pair;
        console.log(`[${idx + 1}/${uniquePairs.length}] Procesare ${client_phone} (${brand_key})...`);

        // 2. Citim ultimele 100 mesaje
        const { data: msgs } = await vertexDb
            .from('vertex_messages')
            .select('role, content')
            .eq('client_phone', client_phone)
            .eq('brand_key', brand_key)
            .order('created_at', { ascending: false })
            .limit(100);

        if (!msgs || msgs.length < 3) {
            console.log(`  - Skip: prea puține mesaje (${msgs?.length || 0})`);
            continue;
        }

        const transcript = msgs.reverse()
            .map(m => `[${m.role === 'model' ? 'AI' : 'Client'}]: ${m.content || ''}`)
            .join('\n');

        // 3. Extracție Gemini
        const extracted = await callGeminiExtractJSON(transcript);
        if (!extracted || Object.keys(extracted).length === 0) {
            console.log(`  - Skip: nicio informație extrasă.`);
            continue;
        }

        // 4. Upsert în client_notebooks_v2
        const { error: upsertErr } = await mainDb
            .from('client_notebooks_v2')
            .upsert({
                phone_number: client_phone,
                wa_number: brand_key || '',
                brand_key: brand_key || null,
                clean_notebook: extracted,
                summary_updated_at: new Date().toISOString()
            }, { onConflict: 'phone_number,wa_number' });

        if (upsertErr) {
            console.error(`  ❌ Eroare upsert pentru ${client_phone}:`, upsertErr.message);
        } else {
            console.log(`  ✅ Succes: ${Object.keys(extracted).length} câmpuri salvate.`);
        }

        // Mică pauză pentru a nu bloca Gemini API (Rate Limits)
        await new Promise(r => setTimeout(r, 500));
    }

    console.log('🏁 Backfill finalizat.');
}

runBackfill();
