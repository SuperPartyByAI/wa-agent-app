/**
 * memorySummarizer.mjs — Memorie continuă client (Opțiunea 3)
 *
 * La fiecare SUMMARY_TRIGGER_MSGS mesaje noi, apelează Gemini pentru un rezumat
 * compact al întregii istorii a clientului. Rezumatul se salvează în ai_client_notebooks
 * și se injectează în system prompt-ul AI-ului la fiecare răspuns.
 *
 * Schema ai_client_notebooks: client_id (uuid PK), client_memory_summary (text),
 *   summary_updated_at (timestamptz), messages_at_last_summary (int)
 *
 * Cost: ~$0.0001/actualizare (2x flash-lite, tot ieftin)
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// gemini-2.0-flash (flash-lite indisponibil pe chei noi — 2x cost, tot ieftin)
const SUMMARY_MODEL = 'gemini-2.5-flash-lite';
const SUMMARY_TRIGGER_MSGS = 30;
const SUMMARY_WINDOW_MSGS = 150;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ─── Rezolvă client_id din telefon ───
async function resolveClientId(phoneE164) {
    const { data } = await supabase
        .from('clients')
        .select('id')
        .eq('real_phone_e164', phoneE164)
        .maybeSingle();
    return data?.id || null;
}

// ─── Gemini call pentru summary ───
async function callGeminiSummary(prompt) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${SUMMARY_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
    const body = {
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        systemInstruction: {
            role: 'system',
            parts: [{ text: `Ești un sistem de memorie pentru Superparty (firma de petreceri copii).
Citești istoricul conversației cu un client și faci un rezumat COMPACT și PRECIS.
REGULI:
1. Max 300 cuvinte
2. Include OBLIGATORIU: ce petreceri a discutat (dată, tip serviciu, personaj, locație, preț), preferințe, detalii familie (copii, vârste), metodă plată
3. Ignoră mesajele bland (salut, mulțumesc, ok)
4. Scrie la persoana 3: "Clientul a cerut..."
5. Dacă există un rezumat anterior, îmbină-l cu datele noi — nu repeta ce era deja acolo` }]
        },
        generationConfig: { temperature: 0.1, maxOutputTokens: 512 }
    };

    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(20000)
    });

    if (!res.ok) {
        const err = await res.text();
        throw new Error(`Gemini HTTP ${res.status}: ${err.substring(0, 200)}`);
    }

    const data = await res.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || null;
}

// ─── Verifică dacă trebuie actualizat summary-ul ───
export async function shouldUpdateSummary(phoneE164, conversationId) {
    try {
        const { count: totalMsgs } = await supabase
            .from('messages')
            .select('*', { count: 'exact', head: true })
            .eq('conversation_id', conversationId);

        const clientId = await resolveClientId(phoneE164);
        if (!clientId) return false;

        const { data: nb } = await supabase
            .from('ai_client_notebooks')
            .select('messages_at_last_summary')
            .eq('client_id', clientId)
            .maybeSingle();

        const lastCount = nb?.messages_at_last_summary || 0;
        const newMsgs = (totalMsgs || 0) - lastCount;
        return newMsgs >= SUMMARY_TRIGGER_MSGS;
    } catch {
        return false;
    }
}

// ─── Actualizează summary-ul clientului ───
export async function updateMemorySummary(phoneE164, conversationId) {
    try {
        const clientId = await resolveClientId(phoneE164);
        if (!clientId) return;

        // Citim ultimele N mesaje
        const { data: msgs } = await supabase
            .from('messages')
            .select('content, sender_type, created_at')
            .eq('conversation_id', conversationId)
            .order('created_at', { ascending: false })
            .limit(SUMMARY_WINDOW_MSGS);

        if (!msgs || msgs.length < 5) return;

        // Citim summary-ul existent
        const { data: existingNb } = await supabase
            .from('ai_client_notebooks')
            .select('client_memory_summary, messages_at_last_summary')
            .eq('client_id', clientId)
            .maybeSingle();

        const existingSummary = existingNb?.client_memory_summary || '';

        // Construim transcriptul în ordine cronologică
        const transcript = msgs
            .reverse()
            .map(m => `[${m.sender_type === 'agent' ? 'Superparty' : 'Client'}]: ${m.content || ''}`)
            .join('\n');

        const prompt = existingSummary
            ? `REZUMAT ANTERIOR:\n${existingSummary}\n\n---\nMESAJE NOI (adaugă la rezumatul anterior):\n${transcript}`
            : `CONVERSAȚIE COMPLETĂ:\n${transcript}`;

        const newSummary = await callGeminiSummary(prompt);
        if (!newSummary) return;

        const { count: totalMsgs } = await supabase
            .from('messages')
            .select('*', { count: 'exact', head: true })
            .eq('conversation_id', conversationId);

        await supabase
            .from('ai_client_notebooks')
            .upsert({
                client_id: clientId,
                client_memory_summary: newSummary,
                summary_updated_at: new Date().toISOString(),
                messages_at_last_summary: totalMsgs || 0
            }, { onConflict: 'client_id' });

        console.log(`[MemorySummarizer] ✅ Summary actualizat pt ${phoneE164.substring(0, 8)}*** (${msgs.length} msg → ${newSummary.length} chars)`);
    } catch (err) {
        console.warn(`[MemorySummarizer] Non-fatal:`, err.message);
    }
}

// ─── Citește summary-ul curent pentru injecție în prompt ───
export async function loadMemorySummary(phoneE164) {
    try {
        const clientId = await resolveClientId(phoneE164);
        if (!clientId) return '';

        const { data } = await supabase
            .from('ai_client_notebooks')
            .select('client_memory_summary')
            .eq('client_id', clientId)
            .maybeSingle();

        return data?.client_memory_summary || '';
    } catch {
        return '';
    }
}

// ─── Construiește secțiunea de memorie pentru system prompt ───
export function buildMemorySection(summary) {
    if (!summary || summary.trim().length === 0) return '';
    return `\n\n=== MEMORIE CLIENT (din conversațiile anterioare) ===\n${summary}\n=== SFÂRȘIT MEMORIE ===`;
}

// ─── Clean Notebook V2: extrage JSON structurat și salvează în client_notebooks_v2 ───
const CLEAN_NOTEBOOK_MODEL = 'gemini-2.0-flash-lite';

// Câmpuri comune prezente indiferent de rol
const BASE_FIELDS = ['data_eveniment', 'ora_eveniment', 'locatie', 'pret_discutat', 'metoda_plata', 'observatii'];

// ─── Încarcă roleMap din DB: { role, keywords[], fields[] } ───
async function loadRoleMap() {
    try {
        const { data } = await supabase
            .from('ai_knowledge_base')
            .select('knowledge_key, policy_config')
            .ilike('knowledge_key', 'role_%')
            .eq('active', true);

        if (!data?.length) return [];

        return data.map(row => ({
            role: row.knowledge_key.replace('role_', ''),
            label: row.policy_config?.label || row.knowledge_key,
            keywords: row.policy_config?.triggers?.keywords || [],
            fields: row.policy_config?.constraints?.must_collect_fields || []
        }));
    } catch (err) {
        console.warn('[CleanNotebook] loadRoleMap failed (non-fatal):', err.message);
        return [];
    }
}

// ─── Detectează rolul din transcript prin keyword matching ───
function detectRoleFromTranscript(transcript, roleMap) {
    const text = transcript.toLowerCase();
    for (const role of roleMap) {
        const hit = role.keywords.some(kw => kw && text.includes(kw.toLowerCase()));
        if (hit) return role;
    }
    return null;
}

// ─── Apel Gemini pentru extracție JSON cu câmpuri dinamice ───
async function callGeminiExtractJSON(prompt, fieldsToExtract, detectedRoleLabel) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${CLEAN_NOTEBOOK_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

    const roleContext = detectedRoleLabel
        ? `Serviciu detectat: ${detectedRoleLabel}.`
        : 'Serviciu neidentificat — extrage câmpurile de bază.';

    const body = {
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        systemInstruction: {
            role: 'system',
            parts: [{ text: `Ești un sistem de extracție date pentru Superparty (firma de petreceri copii).
${roleContext}
Analizezi conversația și returnezi DOAR un JSON valid cu câmpurile găsite.
NU inventa date care nu există în conversație.
Returnează EXCLUSIV JSON, fără text suplimentar, fără markdown.
Câmpuri de extras: ${fieldsToExtract.join(', ')}` }]
        },
        generationConfig: { temperature: 0.0, maxOutputTokens: 512, responseMimeType: 'application/json' }
    };

    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15000)
    });

    if (!res.ok) return null;
    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (!text) return null;
    try { return JSON.parse(text); } catch { return null; }
}

export async function updateCleanNotebook(phoneE164, waNumber, conversationId) {
    if (!phoneE164 || !conversationId) return;
    try {
        // 1. Citim ultimele 100 mesaje pentru extracție
        const { data: msgs } = await supabase
            .from('messages')
            .select('content, sender_type, created_at')
            .eq('conversation_id', conversationId)
            .order('created_at', { ascending: false })
            .limit(100);

        if (!msgs || msgs.length < 3) return;

        const transcript = msgs.reverse()
            .map(m => `[${m.sender_type === 'agent' ? 'AI' : 'Client'}]: ${m.content || ''}`)
            .join('\n');

        // 2. Încărcăm harta de roluri (triggers + câmpuri) din DB
        const roleMap = await loadRoleMap();

        // 3. Detectăm rolul prin keyword matching în transcript
        const detectedRole = detectRoleFromTranscript(transcript, roleMap);

        // 4. Construim lista de câmpuri: bază + specifice rolului detectat
        const roleFields = detectedRole?.fields || [];
        const fieldsToExtract = [...new Set([...BASE_FIELDS, ...roleFields])];

        if (detectedRole) {
            console.log(`[CleanNotebook] Rol detectat: ${detectedRole.role} (${detectedRole.label}) → ${fieldsToExtract.length} câmpuri`);
        } else {
            console.log(`[CleanNotebook] Niciun rol detectat → câmpuri de bază (${fieldsToExtract.length})`);
        }

        // 5. Citim notebook-ul curat existent (merge cu datele noi)
        const { data: existing } = await supabase
            .from('client_notebooks_v2')
            .select('clean_notebook')
            .eq('phone_number', phoneE164)
            .eq('wa_number', waNumber || '')
            .maybeSingle();

        const existingData = existing?.clean_notebook || {};
        const existingStr = Object.keys(existingData).length > 0
            ? `DATE CUNOSCUTE DEJA:\n${JSON.stringify(existingData, null, 2)}\n\n`
            : '';

        const prompt = `${existingStr}CONVERSAȚIE (extrage/actualizează câmpurile relevante):\n${transcript}`;

        // 6. Extragere JSON cu câmpuri dinamice specifice rolului
        const extracted = await callGeminiExtractJSON(prompt, fieldsToExtract, detectedRole?.label);
        if (!extracted || Object.keys(extracted).length === 0) return;

        // 7. Merge: datele noi suprascriu cele vechi pentru același câmp
        const merged = { ...existingData, ...extracted };
        // Adăugăm rolul detectat dacă nu există deja
        if (detectedRole && !merged.rol_detectat) {
            merged.rol_detectat = detectedRole.role;
        }
        // Curățăm câmpurile goale sau null
        Object.keys(merged).forEach(k => {
            if (merged[k] === null || merged[k] === '' || merged[k] === 'null') delete merged[k];
        });

        await supabase.from('client_notebooks_v2').upsert({
            phone_number: phoneE164,
            wa_number: waNumber || '',
            brand_key: waNumber || null,
            clean_notebook: merged,
            summary_updated_at: new Date().toISOString()
        }, { onConflict: 'phone_number,wa_number' });

        console.log(`[CleanNotebook] ✅ Actualizat pt ${phoneE164.substring(0, 8)}*** → rol: ${detectedRole?.role || 'generic'}, ${Object.keys(merged).length} câmpuri`);
    } catch (err) {
        console.warn(`[CleanNotebook] Non-fatal:`, err.message);
    }
}

