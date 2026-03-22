/**
 * embeddingService.mjs — RAG embedding pipeline pentru Superparty
 * 
 * Folosește Google text-embedding-004 pentru a converti mesajele WhatsApp
 * în vectori semantici stocați în pgvector (Supabase).
 * 
 * Funcții:
 *   embedText(text)                    → vector[768]
 *   indexMessage(...)                  → stochează embedding în DB
 *   findRelevantContext(clientId, q)   → top-K mesaje similare
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const GEMINI_API_KEY = process.env.VERTEX_AI_API_KEY || process.env.GEMINI_API_KEY;
const EMBEDDING_MODEL = 'gemini-embedding-001';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const db = SUPABASE_URL && SUPABASE_KEY ? createClient(SUPABASE_URL, SUPABASE_KEY) : null;

// ─── Rate limit helper ───
// text-embedding-004: 1500 req/min pe free tier → max 1 req/40ms
let lastEmbedCall = 0;
async function rateLimitedSleep() {
    const now = Date.now();
    const elapsed = now - lastEmbedCall;
    if (elapsed < 50) await new Promise(r => setTimeout(r, 50 - elapsed));
    lastEmbedCall = Date.now();
}

/**
 * Generează un vector de 768 dimensiuni pentru textul dat.
 * @param {string} text
 * @returns {number[]|null} — vector sau null la eroare
 */
export async function embedText(text) {
    if (!GEMINI_API_KEY || !text?.trim()) return null;
    
    await rateLimitedSleep();
    
    try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${EMBEDDING_MODEL}:embedContent?key=${GEMINI_API_KEY}`;
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: `models/${EMBEDDING_MODEL}`,
                content: { parts: [{ text: text.substring(0, 2048) }] },
                taskType: 'SEMANTIC_SIMILARITY',
                outputDimensionality: 768
            })
        });

        if (!response.ok) {
            const err = await response.text();
            console.error(`[RAG] Embedding error ${response.status}:`, err.substring(0, 200));
            return null;
        }

        const data = await response.json();
        return data.embedding?.values || null;
    } catch (err) {
        console.error('[RAG] embedText failed:', err.message);
        return null;
    }
}

/**
 * Stochează un mesaj și embedding-ul său în tabela message_embeddings.
 * Dacă mesajul există deja (message_id), nu îl duplică.
 */
export async function indexMessage({ messageId, conversationId, clientId, content }) {
    if (!db || !content?.trim()) return false;

    // Skip dacă deja indexat
    if (messageId) {
        const { data: existing } = await db
            .from('message_embeddings')
            .select('id')
            .eq('message_id', messageId)
            .maybeSingle();
        if (existing) return true; // deja există
    }

    const embedding = await embedText(content);
    if (!embedding) return false;

    const { error } = await db.from('message_embeddings').insert({
        message_id: messageId || null,
        conversation_id: conversationId,
        client_id: clientId || null,
        content: content.substring(0, 2000),
        embedding: `[${embedding.join(',')}]`
    });

    if (error) {
        console.error('[RAG] indexMessage DB error:', error.message);
        return false;
    }
    return true;
}

/**
 * Caută cele mai relevante mesaje pentru un query dat.
 * Filtrează opțional după client_id pentru context specific.
 * 
 * @param {string} query — mesajul/întrebarea curentă
 * @param {string|null} clientId — filtrare per client (recomandat)
 * @param {number} topK — câte rezultate să returneze (default 8)
 * @returns {string[]} — array de texte relevante
 */
export async function findRelevantContext(query, clientId = null, topK = 8) {
    if (!db || !query?.trim()) return [];

    const queryEmbedding = await embedText(query);
    if (!queryEmbedding) return [];

    try {
        const { data, error } = await db.rpc('match_messages', {
            query_embedding: `[${queryEmbedding.join(',')}]`,
            match_client_id: clientId || null,
            match_count: topK
        });

        if (error) {
            console.error('[RAG] findRelevantContext RPC error:', error.message);
            return [];
        }

        // Filtrăm rezultatele cu similaritate scăzută (sub 0.5)
        const relevant = (data || []).filter(r => r.similarity > 0.5);
        return relevant.map(r => r.content);
    } catch (err) {
        console.error('[RAG] findRelevantContext failed:', err.message);
        return [];
    }
}

/**
 * Backfill: indexează mesajele unui client care nu au embedding încă.
 * Folosit o singură dată pentru date istorice.
 * 
 * @param {string} clientId — ID-ul clientului
 * @param {number} limit — max mesaje de indexat (default 100)
 */
export async function backfillClientMessages(clientId, limit = 100) {
    if (!db) return 0;

    // Găsim conversațiile clientului
    const { data: convs } = await db
        .from('conversations')
        .select('id')
        .eq('client_id', clientId)
        .limit(10);

    if (!convs?.length) return 0;

    const convIds = convs.map(c => c.id);

    // Găsim mesajele care nu au embedding
    const { data: msgs } = await db
        .from('messages')
        .select('id, conversation_id, content')
        .in('conversation_id', convIds)
        .eq('sender_type', 'client')
        .order('created_at', { ascending: false })
        .limit(limit);

    if (!msgs?.length) return 0;

    let indexed = 0;
    for (const msg of msgs) {
        const ok = await indexMessage({
            messageId: msg.id,
            conversationId: msg.conversation_id,
            clientId,
            content: msg.content
        });
        if (ok) indexed++;
    }

    return indexed;
}
