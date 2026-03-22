/**
 * backfill_notebooks_v2.mjs
 * 
 * Sincronizare Istoric de nivel Enterprise: citește 6000+ mesaje din Main DB,
 * mapează Sesiunile de WhatsApp la Branduri și extrage datele cu Gemini.
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
Dacă nu găsești informația, lasă NULL.
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
    console.log('🚀 Pornire Backfill Istoric Complet (Main DB)...');

    // 1. Găsim toate conversațiile care au mesaje
    const { data: convs, error: convsErr } = await mainDb
        .from('conversations')
        .select(`
            id,
            session_id,
            clients (
                real_phone_e164
            )
        `)
        .not('clients', 'is', null)
        .order('last_message_at', { ascending: false });

    if (convsErr) {
        console.error('❌ Eroare la citirea conversațiilor:', convsErr.message);
        return;
    }

    console.log(`📊 Găsit ${convs.length} conversații active pentru procesare.`);

    for (const [idx, conv] of convs.entries()) {
        const conversationId = conv.id;
        const sessionId = conv.session_id;
        const phone = conv.clients?.real_phone_e164;
        const brandKey = SESSION_MAP[sessionId] || 'GLOBAL';

        if (!phone || phone.includes('simulator') || phone.includes('TEST')) {
            continue;
        }

        console.log(`[${idx + 1}/${convs.length}] Procesare ${phone} (${brandKey}) [Conv: ${conversationId.slice(0,8)}]...`);

        // 2. Citim ultimele 100 mesaje din conversația respectivă
        const { data: msgs } = await mainDb
            .from('messages')
            .select('sender_type, content')
            .eq('conversation_id', conversationId)
            .order('created_at', { ascending: false })
            .limit(100);

        if (!msgs || msgs.length < 5) {
            console.log(`  - Skip: prea puține mesaje (${msgs?.length || 0})`);
            continue;
        }

        // Construim transcriptul
        const transcript = msgs.reverse()
            .map(m => `[${m.sender_type === 'agent' ? 'Echipă' : 'Client'}]: ${m.content || ''}`)
            .join('\n');

        // 3. Extracție Gemini
        const extracted = await callGeminiExtractJSON(transcript);
        if (!extracted || Object.keys(extracted).length === 0 || Object.values(extracted).every(v => v === null)) {
            console.log(`  - Skip: nicio informație utilă extrasă.`);
            continue;
        }

        // 4. Upsert în client_notebooks_v2
        const { error: upsertErr } = await mainDb
            .from('client_notebooks_v2')
            .upsert({
                phone_number: phone,
                wa_number: brandKey,
                brand_key: brandKey,
                clean_notebook: extracted,
                summary_updated_at: new Date().toISOString()
            }, { onConflict: 'phone_number,wa_number' });

        if (upsertErr) {
            console.error(`  ❌ Eroare upsert pentru ${phone}:`, upsertErr.message);
        } else {
            console.log(`  ✅ Succes: Date extrase și salvate.`);
        }

        // Pauză între cereri Gemini
        await new Promise(r => setTimeout(r, 400));
    }

    console.log('🏁 Backfill Istoric Complet finalizat.');
}

runBackfill();
