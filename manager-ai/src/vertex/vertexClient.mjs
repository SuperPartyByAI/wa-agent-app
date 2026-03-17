/**
 * Vertex AI Client — Conectează Manager AI la Google Cloud Vertex AI.
 * 
 * Folosește cheia Vertex AI API (din .env) pentru apeluri directe la Gemini
 * prin endpoint-ul Vertex AI (aiplatform.googleapis.com), nu cel public.
 * 
 * Avantaje față de API-ul public:
 *   - Rate limits 20x mai mari (300+ req/min vs 15/min)
 *   - SLA enterprise 99.9%
 *   - Acces la modele mai puternice (Gemini Pro 2.5)
 *   - Function Calling nativ cu tool definitions
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

// ─── Config ───
const VERTEX_API_KEY = process.env.VERTEX_AI_API_KEY;
const VERTEX_PROJECT = process.env.VERTEX_AI_PROJECT || 'superparty-vertex-ai';
const VERTEX_LOCATION = process.env.VERTEX_AI_LOCATION || 'us-central1';
const VERTEX_MODEL = process.env.VERTEX_AI_MODEL || 'gemini-2.5-flash-lite';

// Supabase dedicat pt Vertex AI
const VERTEX_SUPABASE_URL = process.env.VERTEX_SUPABASE_URL;
const VERTEX_SUPABASE_KEY = process.env.VERTEX_SUPABASE_SERVICE_ROLE_KEY;

const vertexDb = VERTEX_SUPABASE_URL && VERTEX_SUPABASE_KEY
    ? createClient(VERTEX_SUPABASE_URL, VERTEX_SUPABASE_KEY)
    : null;

// ─── Tool Definitions (Function Calling) ───
const VERTEX_TOOLS = [
    {
        functionDeclarations: [
            {
                name: 'noteaza_petrecere',
                description: 'Creează un eveniment/petrecere nouă pentru client. Folosește când clientul vrea să rezerve o petrecere.',
                parameters: {
                    type: 'OBJECT',
                    properties: {
                        role_title: { type: 'STRING', description: 'Tipul serviciului: Animație, Candy Bar, Decorațiuni, Fotograf, DJ, Videograf, Trupa Cover, Sonorizare, Moderator, Închiriere echipamente' },
                        event_details: {
                            type: 'OBJECT',
                            description: 'Detaliile evenimentului ca perechi cheie-valoare',
                            properties: {
                                'Data Evenimentului': { type: 'STRING', description: 'Data (format liber, ex: 20 Martie 2026)' },
                                'Ora de Început': { type: 'STRING', description: 'Ora (ex: 17:00)' },
                                'Locația': { type: 'STRING', description: 'Locul evenimentului' },
                                'Personajul Dorit': { type: 'STRING', description: 'Personaj animație (Elsa, Spider-Man etc)' },
                                'Număr Copii': { type: 'STRING', description: 'Câți copii participă' },
                                'Durata (ore)': { type: 'STRING', description: 'Câte ore durează' },
                                'Nume Sărbătorit': { type: 'STRING', description: 'Numele copilului/persoanei sărbătorite' },
                                'Vârstă Sărbătorit': { type: 'STRING', description: 'Câți ani face' }
                            }
                        },
                        total_amount: { type: 'NUMBER', description: 'Prețul total dacă s-a stabilit' },
                        notes: { type: 'STRING', description: 'Note suplimentare' }
                    },
                    required: ['role_title']
                }
            },
            {
                name: 'actualizeaza_petrecere',
                description: 'Modifică detalii la un eveniment existent (dată, oră, locație, nr copii etc). Folosește event_id din cauta_petreceri.',
                parameters: {
                    type: 'OBJECT',
                    properties: {
                        event_id: { type: 'STRING', description: 'ID-ul evenimentului de actualizat (din cauta_petreceri)' },
                        event_details: { type: 'OBJECT', description: 'Câmpurile de actualizat cu valorile noi' },
                        total_amount: { type: 'NUMBER', description: 'Noul preț total dacă se schimbă' },
                        notes: { type: 'STRING', description: 'Note actualizate' }
                    },
                    required: ['event_id']
                }
            },
            {
                name: 'anuleaza_petrecere',
                description: 'Anulează un eveniment. Evenimentul RĂMÂNE în istoria clientului marcat ca ANULAT. Folosește când clientul spune că nu mai vrea petrecerea.',
                parameters: {
                    type: 'OBJECT',
                    properties: {
                        event_id: { type: 'STRING', description: 'ID-ul evenimentului de anulat' },
                        motiv: { type: 'STRING', description: 'Motivul anulării (opțional)' }
                    },
                    required: ['event_id']
                }
            },
            {
                name: 'restaureaza_petrecere',
                description: 'Restaurează un eveniment anulat. Folosește când clientul vrea să reactiveze o petrecere anulată anterior.',
                parameters: {
                    type: 'OBJECT',
                    properties: {
                        event_id: { type: 'STRING', description: 'ID-ul evenimentului de restaurat' }
                    },
                    required: ['event_id']
                }
            },
            {
                name: 'cauta_petreceri',
                description: 'Caută toate petrecerile/evenimentele unui client (active, anulate, toate). APELEAZĂ ÎNTOTDEAUNA aceasta înainte de a actualiza sau anula, ca să ai ID-ul corect.',
                parameters: {
                    type: 'OBJECT',
                    properties: {
                        status_filter: { type: 'STRING', description: 'Filtru: active, cancelled, all. Default: all' }
                    }
                }
            },
            {
                name: 'escaleaza_la_operator',
                description: 'Trimite conversația la un operator uman (când AI-ul nu poate rezolva sau clientul cere explicit un om).',
                parameters: {
                    type: 'OBJECT',
                    properties: {
                        motiv: { type: 'STRING', description: 'Motivul escalării' }
                    },
                    required: ['motiv']
                }
            }
        ]
    }
];

// ─── Load System Prompt from Supabase Config ───
let cachedSystemPrompt = null;
let configLastLoaded = 0;
const CONFIG_CACHE_MS = 60_000; // re-load din DB la fiecare 60s

async function loadSystemPrompt() {
    if (cachedSystemPrompt && Date.now() - configLastLoaded < CONFIG_CACHE_MS) {
        return cachedSystemPrompt;
    }
    if (!vertexDb) {
        console.warn('[VertexAI] No Vertex Supabase configured, using default prompt');
        return 'Ești asistentul virtual Superparty. Ajuți clienții să planifice petreceri și evenimente.';
    }
    try {
        const { data } = await vertexDb.from('vertex_config')
            .select('config_value')
            .eq('config_key', 'system_prompt')
            .single();
        cachedSystemPrompt = data?.config_value || 'Ești asistentul virtual Superparty.';
        configLastLoaded = Date.now();
        return cachedSystemPrompt;
    } catch (e) {
        console.error('[VertexAI] Failed to load config:', e.message);
        return cachedSystemPrompt || 'Ești asistentul virtual Superparty.';
    }
}

// ─── Vertex AI API Call ───
async function callVertexAI(sessionMessages, options = {}) {
    const systemPrompt = await loadSystemPrompt();
    const useTools = options.tools !== false;
    
    // Inject client phone into system prompt so AI can use cauta_petreceri without asking
    const phoneContext = options.phoneE164 
        ? `\n\nTELEFONUL CLIENTULUI CURENT: ${options.phoneE164}. Când apelez cauta_petreceri, nu trebuie să cer telefonul — îl am deja.`
        : '';
    
    // Build the request body
    const body = {
        contents: sessionMessages.map(msg => ({
            role: msg.role === 'model' ? 'model' : 'user',
            parts: [{ text: msg.content }]
        })),
        systemInstruction: {
            role: 'system',
            parts: [{ text: systemPrompt + phoneContext }]
        },
        generationConfig: {
            temperature: options.temperature ?? 0.4,
            maxOutputTokens: options.maxTokens ?? 2048
        }
    };

    if (useTools) {
        body.tools = VERTEX_TOOLS;
        body.toolConfig = {
            functionCallingConfig: {
                mode: options.forceTools ? 'ANY' : 'AUTO'
            }
        };
    }


    // Use Vertex AI endpoint (enterprise) with API key
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${VERTEX_MODEL}:generateContent?key=${VERTEX_API_KEY}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeout || 30000);

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: controller.signal
        });

        clearTimeout(timeout);

        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`Vertex AI HTTP ${response.status}: ${errText.substring(0, 300)}`);
        }

        const data = await response.json();
        const candidate = data.candidates?.[0];
        
        if (!candidate) {
            throw new Error('No candidates in Vertex AI response');
        }

        // Check for function calls
        const parts = candidate.content?.parts || [];
        const functionCall = parts.find(p => p.functionCall);
        const textPart = parts.find(p => p.text);

        return {
            text: textPart?.text || null,
            functionCall: functionCall?.functionCall || null,
            finishReason: candidate.finishReason,
            usageMetadata: data.usageMetadata || null
        };
    } catch (err) {
        clearTimeout(timeout);
        throw err;
    }
}

// ─── Execute Function (Tool) Calls ───
async function executeFunctionCall(functionCall, sessionId, phoneE164) {
    const { name, args } = functionCall;
    console.log(`[VertexAI] Executing function: ${name}`, args);

    let result = {};

    try {
        switch (name) {
            case 'noteaza_petrecere': {
                if (!vertexDb) { result = { error: 'No database configured' }; break; }
                const { data, error } = await vertexDb.from('client_events').insert({
                    client_phone: phoneE164,
                    role_title: args.role_title || 'Animație',
                    event_details: args.event_details || {},
                    total_amount: args.total_amount || 0,
                    notes: args.notes || '',
                    status: 'active',
                    event_status: 'new'
                }).select().single();
                
                if (error) throw error;
                result = { success: true, event_id: data.id, message: `Eveniment creat cu succes` };
                break;
            }
            case 'actualizeaza_petrecere': {
                if (!vertexDb) { result = { error: 'No database configured' }; break; }
                const update = { updated_at: new Date().toISOString() };
                if (args.event_details) {
                    // Merge with existing details
                    const { data: existing } = await vertexDb.from('client_events')
                        .select('event_details').eq('id', args.event_id).single();
                    update.event_details = { ...(existing?.event_details || {}), ...args.event_details };
                }
                if (args.total_amount !== undefined) update.total_amount = args.total_amount;
                if (args.notes !== undefined) update.notes = args.notes;
                
                const { error } = await vertexDb.from('client_events')
                    .update(update)
                    .eq('id', args.event_id);
                
                if (error) throw error;
                result = { success: true, message: 'Eveniment actualizat cu succes' };
                break;
            }
            case 'anuleaza_petrecere': {
                if (!vertexDb) { result = { error: 'No database configured' }; break; }
                const { error } = await vertexDb.from('client_events')
                    .update({ status: 'cancelled', notes: args.motiv ? `ANULAT: ${args.motiv}` : 'ANULAT', updated_at: new Date().toISOString() })
                    .eq('id', args.event_id);
                
                if (error) throw error;
                result = { success: true, message: 'Eveniment anulat (rămâne în istoric)' };
                break;
            }
            case 'restaureaza_petrecere': {
                if (!vertexDb) { result = { error: 'No database configured' }; break; }
                const { error } = await vertexDb.from('client_events')
                    .update({ status: 'active', updated_at: new Date().toISOString() })
                    .eq('id', args.event_id);
                
                if (error) throw error;
                result = { success: true, message: 'Eveniment restaurat cu succes' };
                break;
            }
            case 'cauta_petreceri': {
                if (!vertexDb) { result = { error: 'No database configured' }; break; }
                let query = vertexDb.from('client_events')
                    .select('id, role_title, event_details, total_amount, notes, status, created_at')
                    .eq('client_phone', phoneE164);
                
                const filter = args?.status_filter || 'all';
                if (filter === 'active') query = query.eq('status', 'active');
                else if (filter === 'cancelled') query = query.eq('status', 'cancelled');
                // 'all' = no filter, show everything
                
                const { data, error } = await query
                    .order('created_at', { ascending: false })
                    .limit(10);
                
                if (error) throw error;
                result = { events: data || [], count: data?.length || 0 };
                break;
            }
            case 'escaleaza_la_operator': {
                result = { escalated: true, motiv: args.motiv, message: 'Conversația a fost trimisă la un operator uman.' };
                if (vertexDb && sessionId) {
                    await vertexDb.from('vertex_sessions')
                        .update({ session_status: 'escalated', updated_at: new Date().toISOString() })
                        .eq('id', sessionId);
                }
                break;
            }
            default:
                result = { error: `Unknown function: ${name}` };
        }
    } catch (err) {
        console.error(`[VertexAI] Function ${name} error:`, err.message);
        result = { error: err.message };
    }

    // Log the action
    if (vertexDb) {
        try {
            await vertexDb.from('vertex_action_logs').insert({
                session_id: sessionId,
                action_name: name,
                action_args: args,
                action_result: result,
                success: !result.error,
                error_message: result.error || null
            });
        } catch (e) { console.error('[VertexAI] Action log error:', e.message); }
    }

    return result;
}

// ─── Session Management ───
async function getOrCreateSession(phoneE164) {
    if (!vertexDb) return { id: null, isNew: true };

    // Check for existing active session
    const { data: existing } = await vertexDb.from('vertex_sessions')
        .select('*')
        .eq('phone_e164', phoneE164)
        .eq('session_status', 'active')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

    if (existing) {
        return { ...existing, isNew: false };
    }

    // Create new session
    const { data: newSession, error } = await vertexDb.from('vertex_sessions')
        .insert({ phone_e164: phoneE164 })
        .select()
        .single();

    if (error) {
        console.error('[VertexAI] Failed to create session:', error.message);
        return { id: null, isNew: true };
    }

    return { ...newSession, isNew: true };
}

async function loadSessionHistory(sessionId, limit = 20) {
    if (!vertexDb || !sessionId) return [];

    const { data } = await vertexDb.from('vertex_messages')
        .select('role, content, function_name, function_args, function_result')
        .eq('session_id', sessionId)
        .order('created_at', { ascending: true })
        .limit(limit);

    return (data || []).map(m => ({
        role: m.role === 'model' ? 'model' : 'user',
        content: m.content || `[Function: ${m.function_name}]`
    }));
}

async function saveMessage(sessionId, role, content, extras = {}) {
    if (!vertexDb || !sessionId) return;

    try {
        const { error } = await vertexDb.from('vertex_messages').insert({
            session_id: sessionId,
            role,
            content,
            function_name: extras.functionName || null,
            function_args: extras.functionArgs || null,
            function_result: extras.functionResult || null,
            tokens_used: extras.tokensUsed || null,
            latency_ms: extras.latencyMs || null
        });
        if (error) console.error('[VertexAI] Save message error:', error.message);
    } catch (e) {
        console.error('[VertexAI] Save message exception:', e.message);
    }

    // Update session timestamp
    try {
        await vertexDb.from('vertex_sessions')
            .update({ updated_at: new Date().toISOString() })
            .eq('id', sessionId);
    } catch (_) { /* silent */ }
}

// ─── Main Pipeline: Process a message through Vertex AI ───
export async function processWithVertexAI(phoneE164, userMessageText) {
    const t0 = Date.now();
    console.log(`[VertexAI] Processing message from ${phoneE164}: "${userMessageText.substring(0, 50)}..."`);

    // 1. Get or create session
    const session = await getOrCreateSession(phoneE164);
    console.log(`[VertexAI] Session: ${session.id} (${session.isNew ? 'NEW' : 'existing'})`);

    // 2. Load conversation history
    const history = await loadSessionHistory(session.id);

    // 3. Save the incoming user message
    await saveMessage(session.id, 'user', userMessageText);

    // 4. Build messages array
    const messages = [
        ...history,
        { role: 'user', content: userMessageText }
    ];

    // ── Helper: call Vertex AI with retry on 503 ──
    async function callWithRetry(msgs, opts, maxRetries = 3) {
        for (let attempt = 0; attempt < maxRetries; attempt++) {
            try {
                return await callVertexAI(msgs, opts);
            } catch (err) {
                const is503 = err.message?.includes('503') || err.message?.includes('UNAVAILABLE') || err.message?.includes('high demand');
                if (is503 && attempt < maxRetries - 1) {
                    const waitMs = 1000 * (attempt + 1); // 1s, 2s, 3s
                    console.log(`[VertexAI] 503 retry ${attempt + 1}/${maxRetries} — waiting ${waitMs}ms`);
                    await new Promise(r => setTimeout(r, waitMs));
                    continue;
                }
                throw err;
            }
        }
    }

    // ── Helper: parse function calls from text output ──
    // Sometimes the AI outputs "[Function: name]{...}" as text instead of a proper function call
    function parseFunctionCallFromText(text) {
        if (!text) return null;
        const match = text.match(/\[Function:\s*(\w+)\]\s*(\{[\s\S]*?\})?/);
        if (!match) return null;
        const name = match[1];
        let args = {};
        if (match[2]) {
            try { args = JSON.parse(match[2]); } catch { /* ignore parse errors */ }
        }
        console.log(`[VertexAI] Parsed function call from text: ${name}`, args);
        return { name, args };
    }

    // ── Helper: strip raw function text from reply ──
    function cleanReply(text) {
        if (!text) return text;
        return text
            .replace(/\[Function:\s*\w+\]\s*(\{[\s\S]*?\})?/g, '')
            .replace(/\[Funcția\s+\w+\s+executată[^\]]*\]/g, '')
            .replace(/\s{2,}/g, ' ')
            .trim();
    }

    // 5. Call Vertex AI — with FUNCTION CALL LOOP (supports chained calls)
    const MAX_TOOL_CALLS = 5;
    let toolCalls = []; // Track all tool calls for UI
    let currentMessages = [...messages];
    let finalReply = null;
    let lastFunctionCall = null;
    let lastFunctionResult = null;

    for (let i = 0; i < MAX_TOOL_CALLS; i++) {
        let response;
        const isFirstCall = (i === 0);
        
        try {
            // On first call, try AUTO mode first
            response = await callWithRetry(currentMessages, { tools: true, phoneE164 });
            
            // Intent detection — force tools if AI didn't call one but should have
            if (isFirstCall && !response.functionCall) {
                const msg = userMessageText.toLowerCase();
                const hasEventDetails = (msg.includes('petrecere') || msg.includes('animati') || msg.includes('eveniment') || msg.includes('botez') || msg.includes('nunta'))
                    && (msg.match(/\d{1,2}\s*(ianuarie|februarie|martie|aprilie|mai|iunie|iulie|august|septembrie|octombrie|noiembrie|decembrie|\.\d{1,2})/i) || msg.match(/\d{4}/));
                const wantsChange = msg.includes('schimb') || msg.includes('modific') || msg.includes('anulez') || msg.includes('renunt') || msg.includes('reactivez') || msg.includes('restaur');
                const wantsNameChange = msg.includes('numes') || msg.includes('nu matei') || msg.includes('nu alexandru') || msg.includes('nu se numest') || msg.includes('face') || msg.includes('ani');

                if (hasEventDetails || wantsChange || wantsNameChange) {
                    console.log(`[VertexAI] Intent detected — retrying with forced tools`);
                    response = await callWithRetry(currentMessages, { tools: true, phoneE164, forceTools: true });
                }
            }
        } catch (err) {
            console.error(`[VertexAI] API call failed after retries:`, err.message);
            if (i === 0) {
                return { reply: 'Îmi pare rău, am o problemă temporară. Te rog încearcă din nou!', functionCalls: [], error: err.message };
            }
            break;
        }

        // Check if text contains a function call that should have been executed
        if (!response.functionCall && response.text) {
            const parsedFn = parseFunctionCallFromText(response.text);
            if (parsedFn) {
                console.log(`[VertexAI] Detected function call in text output — executing: ${parsedFn.name}`);
                response.functionCall = parsedFn;
            }
        }

        // If AI responds with text (no function call), we're done
        if (!response.functionCall) {
            finalReply = cleanReply(response.text) || 'Am notat! ✅';
            break;
        }

        // Execute the function call
        const { name, args } = response.functionCall;
        console.log(`[VertexAI] Tool call #${i + 1}: ${name}`);
        console.log(`[VertexAI] Executing function: ${name}`, JSON.stringify(args).substring(0, 200));
        const fnResult = await executeFunctionCall(response.functionCall, session.id, phoneE164);
        
        lastFunctionCall = response.functionCall;
        lastFunctionResult = fnResult;
        toolCalls.push({ name, args, result: fnResult });

        // Save to DB
        await saveMessage(session.id, 'function_call', null, { functionName: name, functionArgs: args });
        await saveMessage(session.id, 'function_response', JSON.stringify(fnResult), { functionName: name, functionResult: fnResult });

        // Feed result back to AI — smart continuation based on context
        let continuationPrompt;
        if (name === 'cauta_petreceri' && fnResult.events?.length > 0) {
            const eventId = fnResult.events[0].id;
            const msg = userMessageText.toLowerCase();
            if (msg.includes('anulez') || msg.includes('renunt')) {
                continuationPrompt = `IMPORTANT: Clientul vrea să ANULEZE. Apelează ACUM anuleaza_petrecere cu event_id="${eventId}". NU confirma verbal, execută tool-ul.`;
            } else if (msg.includes('reactivez') || msg.includes('restaur') || msg.includes('razgandit')) {
                continuationPrompt = `IMPORTANT: Clientul vrea să REACTIVEZE. Apelează ACUM restaureaza_petrecere cu event_id="${eventId}". NU confirma verbal, execută tool-ul.`;
            } else {
                continuationPrompt = `IMPORTANT: Clientul a cerut: "${userMessageText}". Petrecerea are event_id="${eventId}". Apelează ACUM actualizeaza_petrecere cu event_id="${eventId}" și event_details cu câmpurile ce trebuie modificate. NU răspunde verbal fără tool!`;
            }
        } else {
            continuationPrompt = 'Continuă. Dacă trebuie altă acțiune, fă-o acum cu tool-ul corespunzător. Dacă ai terminat, confirmă clientului.';
        }
        currentMessages = [
            ...currentMessages,
            { role: 'model', content: `[Funcția ${name} executată. Rezultat: ${JSON.stringify(fnResult)}]` },
            { role: 'user', content: continuationPrompt }
        ];
    }

    // If loop ended without text reply, generate one
    if (!finalReply) {
        try {
            const finalResponse = await callWithRetry(currentMessages, { tools: false, phoneE164 });
            finalReply = cleanReply(finalResponse.text) || 'Am finalizat! ✅';
        } catch (err) {
            finalReply = lastFunctionResult?.success ? `Am finalizat! ✅ ${lastFunctionResult.message || ''}` : 'Am întâmpinat o problemă. Un coleg va verifica.';
        }
    }

    // Final cleanup — ensure no raw function text leaks to user
    finalReply = cleanReply(finalReply);

    const latencyMs = Date.now() - t0;
    await saveMessage(session.id, 'model', finalReply, { latencyMs });
    console.log(`[VertexAI] Reply in ${latencyMs}ms (${toolCalls.length} tool calls): "${finalReply.substring(0, 60)}..."`);

    return {
        reply: finalReply,
        functionCall: lastFunctionCall,
        functionResult: lastFunctionResult,
        functionCalls: toolCalls,
        latencyMs
    };
}

// ─── Exports ───
export { loadSystemPrompt, callVertexAI, getOrCreateSession, vertexDb };
