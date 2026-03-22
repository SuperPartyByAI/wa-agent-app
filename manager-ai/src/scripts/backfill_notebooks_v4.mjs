/**
 * backfill_notebooks_v4.mjs
 * 
 * V4 - Abordare bazată pe CONVERSAȚII:
 * 1. Ia toate client_id-urile unice din tabela 'conversations'.
 * 2. Pentru fiecare: 
 *    - Ia numărul de telefon din 'clients'.
 *    - Ia mesajele din 'messages'.
 *    - Extrage date cu Gemini 2.5.
 *    - Salvează în 'client_notebooks_v2' (cu transcript).
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
            console.error(`  ⚠️ Gemini API Error: ${res.status}`);
            return null;
        }
        const data = await res.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
        return JSON.parse(text);
    } catch (e) {
        return null;
    }
}

async function runV4() {
    console.log('🚀 Pornire Backfill V4 (Conversation-First)...');
    
    // 1. Luăm toate client_id-urile care au conversații
    const { data: convRows, error: convErr } = await mainDb
        .from('conversations')
        .select('client_id, id, session_id')
        .not('client_id', 'is', null)
        .order('updated_at', { ascending: false });

    if (convErr) {
        console.error('❌ Eroare Table Conversations:', convErr.message);
        return;
    }

    // Grupăm conversațiile pe client
    const clientGroups = {};
    convRows.forEach(r => {
        if (!clientGroups[r.client_id]) clientGroups[r.client_id] = [];
        clientGroups[r.client_id].push(r);
    });

    const clientIds = Object.keys(clientGroups);
    console.log(`📊 Găsit ${clientIds.length} clienți unici cu conversații.`);

    let successCount = 0;

    // Procesăm un subset sau tot (limităm la 300 pentru siguranță rețea/timeout într-o singură rulare)
    const toProcess = clientIds.slice(0, 300); 

    for (const [idx, cid] of toProcess.entries()) {
        // 2. Luăm detalii client (telefon)
        const { data: client } = await mainDb
            .from('clients')
            .select('real_phone_e164, brand_key')
            .eq('id', cid)
            .single();

        const phone = client?.real_phone_e164;
        if (!phone || phone === '+0') {
            console.log(`[${idx+1}/${toProcess.length}] Skip ${cid}: Telefon invalid.`);
            continue;
        }

        const convs = clientGroups[cid];
        console.log(`[${idx+1}/${toProcess.length}] Procesare ${phone} (${convs.length} convs)...`);

        // Luăm mesajele din cea mai recentă conversație (pentru început)
        // Sau le putem concatena pe toate. Să luăm ultimele 100 mesaje indiferent de conv.
        const allConvIds = convs.map(c => c.id);
        const { data: msgs } = await mainDb
            .from('messages')
            .select('sender_type, content, created_at')
            .in('conversation_id', allConvIds)
            .order('created_at', { ascending: false })
            .limit(100);

        if (!msgs || msgs.length === 0) {
            console.log(`  - Skip: Niciun mesaj găsit.`);
            continue;
        }

        const transcript = msgs.reverse()
            .map(m => `[${m.sender_type === 'agent' ? 'Echipă' : 'Client'}] (${new Date(m.created_at).toLocaleString('ro-RO')}): ${m.content || ''}`)
            .join('\n');

        const extracted = await callGeminiExtractJSON(transcript);
        
        // Brand Key logic with fallback
        const ALLOWED_KEYS = ['SUPERPARTY', 'DIVERTIX', 'PINKY', 'KASSYA', 'EPIC', 'GALAXY', 'WOWPARTY', 'GLOBAL'];
        let brandKey = SESSION_MAP[convs[0].session_id] || convs[0].brand_key || client.brand_key || 'GLOBAL';
        if (!ALLOWED_KEYS.includes(brandKey)) {
            console.log(`  ⚠️ Brand ${brandKey} unknown, falling back to GLOBAL.`);
            brandKey = 'GLOBAL';
        }

        const { error: upsertErr } = await mainDb
            .from('client_notebooks_v2')
            .upsert({
                phone_number: phone,
                wa_number: brandKey,
                brand_key: brandKey,
                clean_notebook: extracted || {},
                last_transcript: transcript,
                summary_updated_at: new Date().toISOString()
            }, { onConflict: 'phone_number,wa_number' });

        if (upsertErr) {
            console.error(`  ❌ Upsert Fail:`, upsertErr.message);
        } else {
            console.log(`  ✅ Succes [${brandKey}]: ${msgs.length} mesaje sincronizate.`);
            successCount++;
        }

        await new Promise(r => setTimeout(r, 100)); // Pace
    }

    console.log(`🏁 Backfill V4 Finalizat. Clienți salvați: ${successCount}`);
}

runV4();
