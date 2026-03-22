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
import { findRelevantContext, indexMessage } from '../rag/embeddingService.mjs';
import { loadMemorySummary, updateMemorySummary, shouldUpdateSummary, buildMemorySection, updateCleanNotebook } from '../agent/memorySummarizer.mjs';
dotenv.config();

// ─── Config ───
const VERTEX_API_KEY = process.env.VERTEX_AI_API_KEY;
const VERTEX_PROJECT = process.env.VERTEX_AI_PROJECT || 'superparty-vertex-ai';
const VERTEX_LOCATION = process.env.VERTEX_AI_LOCATION || 'us-central1';
const VERTEX_MODEL = 'gemini-2.5-flash-lite';
const EXTRACT_MODEL = 'gemini-2.5-flash-lite';

// Supabase dedicat pt Vertex AI
const VERTEX_SUPABASE_URL = process.env.VERTEX_SUPABASE_URL;
const VERTEX_SUPABASE_KEY = process.env.VERTEX_SUPABASE_SERVICE_ROLE_KEY;

const vertexDb = VERTEX_SUPABASE_URL && VERTEX_SUPABASE_KEY
    ? createClient(VERTEX_SUPABASE_URL, VERTEX_SUPABASE_KEY)
    : null;

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const mainDb = SUPABASE_URL && SUPABASE_KEY ? createClient(SUPABASE_URL, SUPABASE_KEY) : null;

// ─── Tool Definitions (Function Calling) ───

function getVertexTools(cfg) {
    return [
        {
            functionDeclarations: [
                {
                    name: 'noteaza_petrecere',
                    description: cfg.tool_desc_noteaza_petrecere || 'Creează un serviciu nou pentru o petrecere. Extrage și salvează exclusiv câmpurile dictatate de [CONSTRANGERI_DE_COLECTAT] pentru Rolul respectiv din System Prompt.',
                    parameters: {
                        type: 'OBJECT',
                        properties: {
                            role_title: { type: 'STRING', description: 'Tipul serviciului (ex. Animație, Ursitoare, etc.). EXTREM DE IMPORTANT: Alege rolul exact din secțiunea CATALOG SERVICII.' },
                            event_details: {
                                type: 'OBJECT',
                                description: 'Un dicționar JSON cu chei dinamice flexibile. Trebuie să conțină EXACT cheile cerute în [CONSTRANGERI_DE_COLECTAT] pentru acest Rol și nicio altă cheie inventată.',
                            },
                            data_rezervarii_iso: { type: 'STRING' },
                            total_amount: { type: 'NUMBER' },
                            notes: { type: 'STRING' }
                        },
                        required: ['role_title', 'event_details']
                    }
                },
                {
                    name: 'actualizeaza_petrecere',
                    description: cfg.tool_desc_actualizeaza_petrecere || 'Modifică detalii',
                    parameters: {
                        type: 'OBJECT',
                        properties: {
                            event_id: { type: 'STRING' },
                            event_details: { type: 'OBJECT' },
                            total_amount: { type: 'NUMBER' },
                            notes: { type: 'STRING' }
                        },
                        required: ['event_id']
                    }
                },
                {
                    name: 'anuleaza_petrecere',
                    description: cfg.tool_desc_anuleaza_petrecere || 'Anulează un eveniment',
                    parameters: {
                        type: 'OBJECT',
                        properties: {
                            event_id: { type: 'STRING' },
                            motiv: { type: 'STRING' }
                        },
                        required: ['event_id']
                    }
                },
                {
                    name: 'restaureaza_petrecere',
                    description: cfg.tool_desc_restaureaza_petrecere || 'Restaurează',
                    parameters: {
                        type: 'OBJECT',
                        properties: { event_id: { type: 'STRING' } },
                        required: ['event_id']
                    }
                },
                {
                    name: 'cauta_petreceri',
                    description: cfg.tool_desc_cauta_petreceri || 'Caută toate petrecerile',
                    parameters: {
                        type: 'OBJECT',
                        properties: { status_filter: { type: 'STRING' } }
                    }
                },
                {
                    name: 'escaleaza_la_operator',
                    description: cfg.tool_desc_escaleaza || 'Escaleaza la om',
                    parameters: {
                        type: 'OBJECT',
                        properties: { motiv: { type: 'STRING' } },
                        required: ['motiv']
                    }
                }
            ]
        }
    ];
}

// ─── Load System Prompt from Supabase Config ───

let cachedConfig = {};
let configLastLoaded = 0;
const CONFIG_CACHE_MS = 60_000;

async function loadVertexConfig() {
    if (Date.now() - configLastLoaded < CONFIG_CACHE_MS && Object.keys(cachedConfig).length > 0) {
        return cachedConfig;
    }
    if (!vertexDb) return {};
    try {
        const { data } = await vertexDb.from('vertex_config').select('config_key, config_value').eq('brand_key', 'GLOBAL');
        const newCfg = {};
        (data || []).forEach(row => newCfg[row.config_key] = row.config_value);
        cachedConfig = newCfg;
        configLastLoaded = Date.now();
        return cachedConfig;
    } catch (e) {
        console.error('[VertexAI] Failed to load config:', e.message);
        return cachedConfig;
    }
}

async function loadSystemPrompt() {
    const cfg = await loadVertexConfig();
    return cfg.system_prompt || 'Ești asistentul virtual Superparty.';
}

// --- Încărcare Dinamică a Rolurilor configurate live din UI ---
let cachedRolesText = '';
let cachedRolesData = null;
let rolesLastLoaded = 0;
const ROLES_CACHE_MS = 60_000 * 5; // 5 minute cache pentru modificările din interfață

async function loadActiveRolesFromUI() {
    if (Date.now() - rolesLastLoaded < ROLES_CACHE_MS && cachedRolesText) {
        return { rolesText: cachedRolesText, rolesData: cachedRolesData };
    }
    if (!mainDb) return { rolesText: '', rolesData: null };
    try {
        // Căutăm rolurile activate pe baza `knowledge_key` care încep cu `role_`
        const { data } = await mainDb.from('ai_knowledge_base')
            .select('answer_template, policy_config')
            .ilike('knowledge_key', 'role_%')
            .eq('active', true);
            
        if (!data || data.length === 0) return { rolesText: '', rolesData: null };
        
        let rolesBlock = '\n\n═══════════════════════════════════\nCATALOG SERVICII ȘI CONSTRÂNGERI (CITITE DIN UI):\n═══════════════════════════════════\n';
        rolesBlock += 'REGULĂ SUPREMĂ: Când clientul dorește unul din serviciile de mai jos, ESTI OBLIGAT să îi ceri și să salvezi în "event_details" STRICT informațiile din secțiunea [CONSTRANGERI_DE_COLECTAT]!\n\n';
        
        data.forEach(role => {
            const config = role.policy_config || {};
            const title = config.label || (role.answer_template ? role.answer_template.split('\n')[0] : 'Rol Necunoscut');
            const keywords = (config.triggers?.keywords || []).join(', ');
            const constraintsArray = config.constraints?.must_collect_fields || [];
            
            rolesBlock += `🔹 SERVICIU/ROL: ${title}\n`;
            if (keywords) rolesBlock += `   Declanșatori: ${keywords}\n`;
            if (constraintsArray.length > 0) {
                 const numberedConstraints = constraintsArray.map((c, i) => `${i + 1}. ${c}`).join(' -> ');
                 rolesBlock += `   [CONSTRANGERI_DE_COLECTAT] (în ordinea exactă 1 by 1): ${numberedConstraints}\n`;
            }
            rolesBlock += `   > REGULA: Dacă alege acest serviciu, întreabă și completează în <event_details> doar câmpurile listate mai sus!\n`;
            
            // Suport pentru formula de întrebare setată live
            if (config.copy_blocks?.custom_prompts) {
                for (const [field, prompt] of Object.entries(config.copy_blocks.custom_prompts)) {
                     if (prompt) rolesBlock += `   - Pentru a afla "${field}", trebuie să întrebi exact la modul următor: "${prompt}"\n`;
                }
            }
            rolesBlock += '\n';
        });
        
        rolesBlock += '\n=== REGULI DE COLECTARE DYNAMIC FORM FILLER ===\n';
        rolesBlock += '1. Când clientul dorește un serviciu identificabil, APELEAZĂ obligatoriu `noteaza_petrecere`.\n';
        rolesBlock += '2. Când clientul oferă ORICE detaliu util formularelor (chiar dacă nu l-ai cerut tu acuma), EȘTI OBLIGAT SĂ APELEZI `actualizeaza_petrecere`! Daca nu folosesti baza de date interna prin apel, noi prindem goluri in sistem!\n';
        rolesBlock += '3. REGULA SECVENȚIEI "1 BY 1": Uită-te mereu la [CONSTRANGERI_DE_COLECTAT] și vezi care este PRIMA cerință care încă e goală în interiorul `event_details`. Formulează DOAR O SINGURĂ ÎNTREBARE legată strict de acea valoare. NU CERE NICIODATĂ 2 INFORMAȚII.\n';
        rolesBlock += '4. TRATAREA EXCEPȚIILOR: Dacă ceri un Câmp #1 (ex: "Care e data?") și clientul răspunde cu Câmpul #3 (ex: "Îl vreau pe Spider-Man!"), TU PRIMA DATĂ declanșezi funcția `actualizeaza_petrecere` în care bagi Spider-Man. DAR din gură trebuie să îi spui "Super, l-am notat pe Spider-Man. Pentru ce dată dorești petrecerea?". ȚINE CONVERSAȚIA sub control și re-impune constrângerea sărită!\n';
        rolesBlock += '5. DEVIAȚII COGNITIVE (ADAPTABILITATE): Dacă iți pune o întrebare oarecare pe parcursul form-ului, răspunde-i scurt și cuprinzător dar la finalul RĂSPUNSULUI tău, întoarce mereu subiectul catre acea întrebare restantă din formular pe care trebuie sa ii o adresezi. Nu rula 2 requesturi concomitent!\n';
        rolesBlock += '6. OBLIGAȚIE PENTRU JSON (event_details): Când apelezi `noteaza_petrecere` sau `actualizeaza_petrecere`, EȘTI OBLIGAT să scrii INFORMAȚIA COLECTATĂ (chiar și parțială) în dicționarul `event_details`, folosind EXACT numele condiției din [CONSTRANGERI_DE_COLECTAT] ca sub-cheie JSON! Exemplu VITAL: {"event_details": {"date": "23 august", "location": "Sector 3"}}. Sub NICIO FORMA nu trimite event_details: {} gol dacă ai detalii de la client!\n\n';
        
        cachedRolesText = rolesBlock;
        cachedRolesData = data;
        rolesLastLoaded = Date.now();
        return { rolesText: cachedRolesText, rolesData: cachedRolesData };
    } catch (e) {
        console.error('[VertexAI] Failed to load roles from Supabase UI:', e.message);
        return { rolesText: cachedRolesText, rolesData: cachedRolesData };
    }
}


// ─── Vertex AI API Call ───

async function callVertexAI(sessionMessages, options = {}) {
    const cfg = options.cfg || await loadVertexConfig();
    let systemPrompt = cfg.system_prompt || 'Ești asistentul virtual Superparty.';
    
    // Injectăm dinamic fișele de post care forțează structura JSON din unelte
    const { rolesText: activeRolesText, rolesData: activeRolesData } = await loadActiveRolesFromUI();
    if (activeRolesText) {
        systemPrompt += activeRolesText;
    }
    
    // Functie helper generare schema json proprietati
    function extractDynamicPropertiesFromRoles() {
        const props = {};
        if (!activeRolesData) return props;
        activeRolesData.forEach(role => {
            const constraints = role.policy_config?.constraints?.must_collect_fields || [];
            constraints.forEach(c => {
                if (!props[c]) {
                    props[c] = { type: 'STRING', description: `Informația despre ${c}` };
                }
            });
        });
        return props;
    }
    
    const useTools = options.tools !== false;
    
    let activeEventsStr = '';
    if (options.phoneE164 && vertexDb) {
        try {
            const { data: evs } = await mainDb.from('ai_client_events')
                .select('id, role_title, event_details')
                .eq('client_phone', options.phoneE164)
                .eq('status', 'active');
            if (evs && evs.length > 0) {
                activeEventsStr = `

═══════════════════════════════════════
EVENIMENTE DEJA NOTATE PENTRU ACEST CLIENT:
═══════════════════════════════════════
${evs.map((e, i) => `${i+1}. ID: ${e.id} | Rol: ${e.role_title} | Data: ${e.event_details?.['Data Evenimentului'] || e.event_details?.['Data'] || '?'} | Personaj: ${e.event_details?.['Personajul Dorit'] || '?'}`).join('\n')}

${cfg.prompt_rule_event_context || 'REGULĂ CRITICĂ: Evita duplicarea eventurilor anulate. Folosește actualizeaza_petrecere.'}
`;
            }
        } catch(e) { console.error('Error fetching context events', e); }
    }
    
    const phoneContext = options.phoneE164 
        ? `

TELEFONUL CLIENTULUI CURENT: ${options.phoneE164}.` + activeEventsStr
        : '';
        
    let greetingEnforcement = '';
    if (cfg.greeting_rule && sessionMessages.length === 0) {
        greetingEnforcement = `\n\n═══════════════════════════════════\nREGULĂ ABSOLUTĂ PENTRU PRIMUL MESAJ DE SALUT:\n═══════════════════════════════════\nPentru că acesta este primul mesaj din conversație, ești OBLIGAT să răspunzi EXCLUSIV cu afirmația următoare, cuvânt cu cuvânt (fără să adaugi alt text, fără să mai inventezi tu alte formule de salut): "${cfg.greeting_rule}". Nu devia de la acest text sub nicio formă!`;
    }

    // Build the request body
    const body = {
        contents: sessionMessages.map(msg => ({
            role: msg.role === 'model' ? 'model' : 'user',
            parts: [{ text: msg.content }]
        })),
        systemInstruction: {
            role: 'system',
            parts: [{ text: systemPrompt + phoneContext + greetingEnforcement }]
        },
        generationConfig: {
            temperature: options.temperature ?? 0.4,
            maxOutputTokens: options.maxTokens ?? 2048
        }
    };

    if (useTools) {
        const tools = [
            {
                functionDeclarations: [
                    {
                        name: 'noteaza_petrecere',
                        description: cfg.tool_desc_noteaza_petrecere || 'Creează un serviciu nou pentru o petrecere. Extrage și salvează exclusiv câmpurile dictatate de [CONSTRANGERI_DE_COLECTAT] pentru Rolul respectiv din System Prompt.',
                        parameters: {
                            type: 'OBJECT',
                            properties: {
                                event_details: {
                                    type: 'OBJECT',
                                    description: 'Un dicționar JSON cu chei dinamice flexibile.',
                                    properties: extractDynamicPropertiesFromRoles()
                                },
                                data_rezervarii_iso: { type: 'STRING', description: 'Data explicită în format YYYY-MM-DD doar dacă e clară (altfel null).' },
                                total_amount: { type: 'NUMBER' },
                                role_title: { type: 'STRING', description: 'Numele EXACT al rolului / serviciului (ex: Ursitoare, Animație)' }
                            },
                            required: ['event_details', 'role_title']
                        }
                    },
                    {
                        name: 'actualizeaza_petrecere',
                        description: cfg.tool_desc_actualizeaza_petrecere || 'Actualizează detaliile evenimentului. DOAR când clientul a oferit voluntar noi detalii pentru formularele de constrângeri!',
                        parameters: {
                            type: 'OBJECT',
                            properties: {
                                event_details: {
                                    type: 'OBJECT',
                                    description: 'Dicționar cu TOATE câmpurile pe care clientul le-a confirmat deja OR adăugat acum.',
                                    properties: extractDynamicPropertiesFromRoles()
                                },
                                data_rezervarii_iso: { type: 'STRING' },
                                total_amount: { type: 'NUMBER' }
                            },
                            required: ['event_details']
                        }
                    },
                    {
                        name: 'anuleaza_petrecere',
                        description: cfg.tool_desc_anuleaza_petrecere || 'Anulează un eveniment',
                        parameters: {
                            type: 'OBJECT',
                            properties: {
                                event_id: { type: 'STRING' },
                                motiv: { type: 'STRING' }
                            },
                            required: ['event_id']
                        }
                    },
                    {
                        name: 'restaureaza_petrecere',
                        description: cfg.tool_desc_restaureaza_petrecere || 'Restaurează',
                        parameters: {
                            type: 'OBJECT',
                            properties: { event_id: { type: 'STRING' } },
                            required: ['event_id']
                        }
                    },
                    {
                        name: 'cauta_petreceri',
                        description: cfg.tool_desc_cauta_petreceri || 'Caută toate petrecerile',
                        parameters: {
                            type: 'OBJECT',
                            properties: { status_filter: { type: 'STRING' } }
                        }
                    },
                    {
                        name: 'escaleaza_la_operator',
                        description: cfg.tool_desc_escaleaza || 'Escaleaza la om',
                        parameters: {
                            type: 'OBJECT',
                            properties: { motiv: { type: 'STRING' } },
                            required: ['motiv']
                        }
                    }
                ]
            }
        ];
        body.tools = tools;
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

        // Check for function calls (supports multiple parallel calls)
        const parts = candidate.content?.parts || [];
        const functionCalls = parts.filter(p => p.functionCall).map(p => p.functionCall);
        const textPart = parts.find(p => p.text);

        return {
            text: textPart?.text || null,
            functionCalls: functionCalls.length > 0 ? functionCalls : null,
            finishReason: candidate.finishReason,
            usageMetadata: data.usageMetadata || null
        };
    } catch (err) {
        clearTimeout(timeout);
        throw err;
    }
}

// ─── Execute Function (Tool) Calls ───
async function executeFunctionCall(functionCall, sessionId, phoneE164, options = {}) {
    const { name, args } = functionCall;
    const isSim = options.simulationMode === true;
    console.log(`[VertexAI] Executing function: ${name}`, args, isSim ? '(SIMULATION)' : '');

    let result = {};

    try {
        function normStr(str) {
            if (!str) return '';
            let s = String(str).toLowerCase().trim();
            s = s.replace(/ă/g, 'a').replace(/ș/g, 's').replace(/ț/g, 't').replace(/î/g, 'i').replace(/â/g, 'a');
            s = s.replace(/ pentru copii/g, '').trim();
            return s;
        }

        switch (name) {
            case 'noteaza_petrecere': {
                if (!vertexDb) { result = { error: 'No vertex database configured' }; break; }
                const roleTitle = args.role_title || 'Serviciu necunoscut';
                const eventDetails = args.event_details || {};
                
                if (isSim) {
                    result = { success: true, event_id: "SIM-12345", message: `Serviciul ${roleTitle} a fost NOTAT/ACTUALIZAT cu succes (SIMULARE).\n\nATENȚIE AI: Baza de date conține Array-ul de [CONSTRANGERI_DE_COLECTAT] aferent. Caută STRICT PRIMUL câmp din Array (cel cu numărul/indexul minim de ordine 1,2,3...) pe care clientul încă NU l-a completat în "event_details". Pune-i clientului O SINGURĂ ÎNTREBARE prin care să afli acel câmp lipsă și NIMIC MAI MULT! Respectă Flow-ul Secvențial!` };
                    break;
                }

                // Preluăm client_id-ul real din DB
                const { data: chkClient } = await mainDb.from('clients').select('id').eq('real_phone_e164', phoneE164).limit(1).maybeSingle();
                const clientId = chkClient?.id;
                if (!clientId) { result = { error: 'Eroare: Clientul nu există în baza de date principală.' }; break; }

                const dateFromArgs = normStr(eventDetails['Data Evenimentului'] || eventDetails['Data'] || eventDetails['data_evenimentului'] || '');
                const roleFromArgs = normStr(roleTitle);
                
                // Căutăm evenimente active ale clientului
                const { data: existingEvents } = await mainDb.from('ai_client_events')
                    .select('id, servicii_cerute, data_eveniment, locatie')
                    .eq('client_id', clientId)
                    .in('status', ['draft', 'active']);
                    
                let existingEventId = null;
                let existingServicii = {};
                let matchingSlotKey = null;
                
                if (existingEvents && existingEvents.length > 0) {
                    for (const ev of existingEvents) {
                        const dbDate = normStr(ev.data_eveniment || '');
                        const srv = ev.servicii_cerute || {};
                        // Încercăm să grupăm per dată:
                        if (dbDate === dateFromArgs || !dbDate || !dateFromArgs) {
                            existingEventId = ev.id;
                            existingServicii = { ...srv };
                            
                            // Căutăm dacă rolul există deja în "servicii_cerute"
                            for (const [vKey, vObj] of Object.entries(existingServicii)) {
                                const existRole = normStr(vObj.role_title || '');
                                if (existRole === roleFromArgs || existRole.includes(roleFromArgs) || roleFromArgs.includes(existRole)) {
                                    matchingSlotKey = vKey;
                                    break;
                                }
                            }
                            break;
                        }
                    }
                }
                
                if (existingEventId) {
                    const slotKey = matchingSlotKey || ('SLOT_' + Math.random().toString(36).substring(2, 6).toUpperCase());
                    const currentSlotRaw = existingServicii[slotKey] || {};
                    existingServicii[slotKey] = {
                        ID_Vizual: slotKey,
                        role_title: roleTitle,
                        ...currentSlotRaw,
                        ...eventDetails
                    };

                    const rawDateUpdExisting = eventDetails['Data Evenimentului'] || eventDetails['Data'];
                    const updObj = {
                        servicii_cerute: existingServicii,
                        locatie: eventDetails['Locația'] || eventDetails['Orasul'] || eventDetails['Oraș'] || undefined,
                        buget_estimat: args.total_amount || 0,
                        updated_at: new Date().toISOString()
                    };
                    if (rawDateUpdExisting && /^20\d{2}-\d{2}-\d{2}$/.test(rawDateUpdExisting.trim())) {
                        updObj.data_eveniment = rawDateUpdExisting.trim();
                    }

                    const { error: updErr } = await mainDb.from('ai_client_events').update(updObj).eq('id', existingEventId);
                    
                    if (updErr) {
                         result = { error: updErr.message };
                         break;
                    }
                    result = { success: true, event_id: existingEventId, visual_id: slotKey, message: `Serviciul ${roleTitle} a fost ACTUALIZAT cu succes sub ID ${slotKey}.\n\nATENȚIE AI: Baza de date conține Array-ul de [CONSTRANGERI_DE_COLECTAT] aferent. Caută URMĂTORUL câmp din Array pe care clientul NU l-a completat încă în 'event_details'. Pune-i clientului O SINGURĂ ÎNTREBARE prin care să afli acel câmp și NIMIC MAI MULT!` };
                } else {
                    const slotKey = 'SLOT_' + Math.random().toString(36).substring(2, 6).toUpperCase();
                    const newServicii = {
                        [slotKey]: {
                            ID_Vizual: slotKey,
                            role_title: roleTitle,
                            ...eventDetails
                        }
                    };

                    const rawDateIns = eventDetails['Data Evenimentului'] || eventDetails['Data'];
                    let strictDate = null;
                    if (rawDateIns && /^20\d{2}-\d{2}-\d{2}$/.test(rawDateIns.trim())) {
                         strictDate = rawDateIns.trim();
                    }

                    const insertObj = {
                        client_id: clientId,
                        status: 'draft',
                        servicii_cerute: newServicii,
                        data_eveniment: strictDate,
                        locatie: eventDetails['Locația'] || eventDetails['Orasul'] || eventDetails['Oraș'] || null,
                        buget_estimat: args.total_amount || 0
                    };
                    
                    const { data: inserted, error: insErr } = await mainDb.from('ai_client_events').insert(insertObj).select('id').single();

                    if (insErr) {
                        result = { error: insErr.message };
                        break;
                    }
                    result = { success: true, event_id: inserted?.id, visual_id: slotKey, message: `Serviciul ${roleTitle} a fost NOTAT cu succes.\n\nATENȚIE AI: Baza de date conține Array-ul de [CONSTRANGERI_DE_COLECTAT] aferent. Caută STRICT PRIMUL câmp din Array (cel cu indexul numeric minim) pe care clientul încă NU l-a completat. Pune-i clientului O SINGURĂ ÎNTREBARE prin care să afli acel câmp lipsă și NIMIC MAI MULT!` };
                }
                break;
            }

            case 'actualizeaza_petrecere': {
                if (isSim) {
                    result = { success: true, message: `Eveniment actualizat cu succes (SIMULARE).\n\nATENȚIE AI: Baza de date conține Array-ul de [CONSTRANGERI_DE_COLECTAT] aferent. Caută STRICT PRIMUL câmp din Array lipsă. Pune-i clientului O SINGURĂ ÎNTREBARE!` };
                    break;
                }
                if (!vertexDb) { result = { error: 'No vertex database configured' }; break; }

                const { data: existing } = await mainDb.from('ai_client_events')
                    .select('servicii_cerute').eq('id', args.event_id).single();

                if (!existing) {
                    result = { error: 'Event ID invalid.' };
                    break;
                }

                const srv = existing.servicii_cerute || {};
                
                // Actualizăm ultimul serviciu modificat sau cel găsit global, deoarece AI poate oferi chei la nivel ROOT in 'event_details' si trebuie combinate
                let slotToUpdate = Object.keys(srv)[0]; // Fallback
                for (const k of Object.keys(srv)) {
                    if (args.event_details && args.event_details.role_title && srv[k].role_title === args.event_details.role_title) {
                        slotToUpdate = k;
                        break;
                    }
                }

                if (slotToUpdate && args.event_details) {
                    srv[slotToUpdate] = { ...srv[slotToUpdate], ...args.event_details };
                }
                
                const update = { updated_at: new Date().toISOString(), servicii_cerute: srv };
                const rawDateUpd = args.event_details?.['Data Evenimentului'] || args.event_details?.['Data'];
                if (rawDateUpd && /^20\d{2}-\d{2}-\d{2}$/.test(rawDateUpd.trim())) {
                    update.data_eveniment = rawDateUpd.trim();
                }
                
                if (args.event_details?.['Locația'] || args.event_details?.['Orasul'] || args.event_details?.['Oraș']) {
                    update.locatie = args.event_details['Locația'] || args.event_details['Orasul'] || args.event_details['Oraș'];
                }
                
                if (args.total_amount !== undefined) update.buget_estimat = args.total_amount;
                
                const { error } = await mainDb.from('ai_client_events')
                    .update(update)
                    .eq('id', args.event_id);
                
                if (error) {
                    result = { error: error.message };
                    break;
                }
                result = { success: true, message: `Eveniment actualizat cu succes.\n\nATENȚIE AI: Rămâi secvențial! Pune-i clientului O SINGURĂ ÎNTREBARE prin care să afli cel mai mic câmp lipsă și NIMIC MAI MULT!` };
                break;
            }

            case 'anuleaza_petrecere': {
                if (isSim) { result = { success: true, message: 'Eveniment anulat (SIMULARE)' }; break; }
                if (!vertexDb) { result = { error: 'No vertex database configured' }; break; }
                const { error } = await mainDb.from('ai_client_events')
                    .update({ status: 'cancelled', updated_at: new Date().toISOString() })
                    .eq('id', args.event_id);
                
                if (error) throw error;
                result = { success: true, message: 'Eveniment anulat (rămâne în istoric)' };
                break;
            }

            case 'restaureaza_petrecere': {
                if (isSim) { result = { success: true, message: 'Eveniment restaurat cu succes (SIMULARE)' }; break; }
                if (!vertexDb) { result = { error: 'No vertex database configured' }; break; }
                const { error } = await mainDb.from('ai_client_events')
                    .update({ status: 'draft', updated_at: new Date().toISOString() })
                    .eq('id', args.event_id);
                
                if (error) throw error;
                result = { success: true, message: 'Eveniment restaurat cu succes' };
                break;
            }

            case 'cauta_petreceri': {
                if (!vertexDb) { result = { error: 'No database configured' }; break; }
                const { data: clientRow } = await mainDb.from('clients').select('id').eq('real_phone_e164', phoneE164).maybeSingle();
                const clientId = clientRow?.id;
                
                if (!clientId) { result = { events: [], count: 0 }; break; }

                let query = mainDb.from('ai_client_events')
                    .select('id, status, ocazie, data_eveniment, ora_eveniment, locatie, servicii_cerute, buget_estimat, created_at')
                    .eq('client_id', clientId);
                
                const filter = args?.status_filter || 'all';
                if (filter === 'active') query = query.in('status', ['draft', 'active']);
                else if (filter === 'cancelled') query = query.eq('status', 'cancelled');
                
                const { data, error } = await query
                    .order('created_at', { ascending: false })
                    .limit(10);
                
                if (error) throw error;
                result = { events: data || [], count: data?.length || 0 };
                break;
            }

            case 'escaleaza_la_operator': {
                result = { escalated: true, motiv: args.motiv, message: 'Conversația a fost trimisă la un operator uman.' };
                if (vertexDb && sessionId && !isSim) {
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
    if (vertexDb && !isSim) {
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

async function loadSessionHistory(sessionId, limit = 100) {
    if (!vertexDb || !sessionId) return [];

    const { data } = await vertexDb.from('vertex_messages')
        .select('role, content, function_name, function_args, function_result')
        .eq('session_id', sessionId)
        .order('created_at', { ascending: false })
        .limit(limit);

    // Returnăm în ordine cronologică (ascending) pentru context corect
    return ((data || []).reverse()).map(m => ({
        role: m.role === 'model' ? 'model' : 'user',
        content: m.content || `[Function: ${m.function_name}]`
    }));
}

// ─── Clean Notebook: citire notebook curat per (phone, wa_number) ───
async function loadCleanNotebook(phoneE164, waNumber) {
    if (!mainDb || !phoneE164) return null;
    try {
        const { data } = await mainDb.from('client_notebooks_v2')
            .select('clean_notebook, summary_updated_at')
            .eq('phone_number', phoneE164)
            .eq('wa_number', waNumber || '')
            .maybeSingle();
        return data?.clean_notebook || null;
    } catch (err) {
        console.warn('[VertexAI] Clean notebook load failed (non-fatal):', err.message);
        return null;
    }
}

function buildCleanNotebookSection(notebook) {
    if (!notebook || Object.keys(notebook).length === 0) return '';
    const lines = Object.entries(notebook)
        .filter(([, v]) => v)
        .map(([k, v]) => `  - ${k}: ${v}`);
    if (lines.length === 0) return '';
    return `\n\n--- [Memorie Persistentă Client] ---\n${lines.join('\n')}\n--- [Sfârșit Memorie] ---`;
}

async function saveMessage(sessionId, role, content, extras = {}, options = {}) {
    if (options.simulationMode) return;
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

export async function processWithVertexAI(phoneE164, userMessageText, options = {}) {
    const cfg = await loadVertexConfig();
    options.cfg = cfg;

    const t0 = Date.now();
    const isSim = options.simulationMode === true;
    console.log(`[VertexAI] Processing message from ${phoneE164}: "${userMessageText.substring(0, 50)}..." [Sim=${isSim}]`);

    // 1. Get or create session
    const session = isSim ? { id: "sim-" + Date.now(), isNew: false } : await getOrCreateSession(phoneE164);
    if (!isSim) console.log(`[VertexAI] Session: ${session.id} (${session.isNew ? 'NEW' : 'existing'})`);

    // 2. Load conversation history
    const history = options.sessionMessages ? options.sessionMessages : await loadSessionHistory(session.id);

    // 3. Save the incoming user message
    await saveMessage(session.id, 'user', userMessageText, {}, options);

    // 4. Build messages array with RAG context
    // Căutăm context relevant din istoricul de mesaje al clientului
    let ragContext = '';
    try {
        // Găsim client_id din telefon pentru a filtra per client
        const { data: clientRow } = await mainDb?.from('clients')
            .select('id').eq('real_phone_e164', phoneE164).maybeSingle() || {};
        const ragClientId = clientRow?.id || null;

        const relevantMsgs = await findRelevantContext(userMessageText, ragClientId, 8);
        if (relevantMsgs.length > 0) {
            ragContext = `\n\n--- Context relevant din istoricul clientului (RAG) ---\n${relevantMsgs.join('\n')}\n--- Sfârșit context RAG ---`;
            console.log(`[VertexAI] RAG: ${relevantMsgs.length} mesaje relevante găsite pentru context`);
        }

        // Indexăm și mesajul curent pentru viitor
        if (ragClientId) {
            const { data: convRow } = await mainDb?.from('conversations')
                .select('id').eq('client_id', ragClientId)
                .order('updated_at', { ascending: false }).limit(1).maybeSingle() || {};
            if (convRow?.id) {
                indexMessage({
                    conversationId: convRow.id,
                    clientId: ragClientId,
                    content: userMessageText
                }).catch(() => {}); // fire-and-forget, nu blocăm pipeline-ul
            }
        }
    } catch (ragErr) {
        console.warn('[VertexAI] RAG context fetch failed (non-fatal):', ragErr.message);
    }

    // 4b. Load clean notebook (Notebook CURAT) + memory summary și injectează în context
    try {
        // Notebook CURAT: JSON distilat persistent per (phone, wa_number)
        const myWaNumber = options.myWaNumber || '';
        const cleanNotebook = await loadCleanNotebook(phoneE164, myWaNumber);
        if (cleanNotebook) {
            ragContext += buildCleanNotebookSection(cleanNotebook);
            console.log(`[VertexAI] Clean Notebook: injectat pentru ${phoneE164}@${myWaNumber} (${Object.keys(cleanNotebook).length} câmpuri)`);
        }

        // Memory summary vechi (fallback dacă nu există notebook curat)
        const memorySummary = await loadMemorySummary(phoneE164);
        if (memorySummary && !cleanNotebook) {
            ragContext += buildMemorySection(memorySummary);
            console.log(`[VertexAI] Memory summary (fallback): injectat (${memorySummary.length} chars)`);
        }
    } catch (memErr) {
        console.warn('[VertexAI] Memory/Notebook load failed (non-fatal):', memErr.message);
    }

    const messages = [
        ...history,
        { role: 'user', content: userMessageText + ragContext }
    ];

    // Fire-and-forget: update summary async dacă s-au acumulat 30+ mesaje noi (Skip in sim mode)
    if (!isSim) {
        try {
            const { data: convRow } = await mainDb?.from('conversations')
                .select('id').eq('client_id', (await mainDb?.from('clients')
                    .select('id').eq('real_phone_e164', phoneE164).maybeSingle())?.data?.id)
                .order('updated_at', { ascending: false }).limit(1).maybeSingle() || {};
            const convId = convRow?.id;
            if (convId) {
                shouldUpdateSummary(phoneE164, convId).then(needsUpdate => {
                    if (needsUpdate) {
                        // Update legacy text summary
                        updateMemorySummary(phoneE164, convId).catch(() => {});
                        // Update clean notebook V2 (JSON structurat)
                        updateCleanNotebook(phoneE164, options.myWaNumber || '', convId).catch(() => {});
                    }
                }).catch(() => {});
            }
        } catch { /* non-fatal */ }
    }

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
            if (isFirstCall && !response.functionCalls) {
                const msg = userMessageText.toLowerCase();
                const hasEventDetails = (msg.includes('petrecere') || msg.includes('animati') || msg.includes('eveniment') || msg.includes('botez') || msg.includes('nunta'))
                    && (msg.match(/\d{1,2}\s*(ianuarie|februarie|martie|aprilie|mai|iunie|iulie|august|septembrie|octombrie|noiembrie|decembrie|\.\d{1,2})/i) || msg.match(/\d{4}/));
                const wantsChange = msg.includes('schimb') || msg.includes('modific') || msg.includes('anulez') || msg.includes('renunt') || msg.includes('reactivez') || msg.includes('restaur');
                const wantsNameChange = msg.includes('numes') || msg.includes('nu matei') || msg.includes('nu alexandru') || msg.includes('nu se numest') || msg.includes('face') || msg.includes('ani');
                
                // Detectăm mesaje cu detalii pure (personaj, copii, oră, locație) — știm că există eveniment activ
                const hasPartialDetails = (
                    msg.match(/\bora\b|\bla ora\b|\bincep|va\s+incepe/i) ||
                    msg.match(/\b(\d+)\s*(copii|copilasi|copilași|invitati|invitați)/i) ||
                    msg.match(/\b(elsa|spiderman|omul\s+paianjen|mickey|minnie|frozen|batman|superman|paw\s*patrol|bluey|barbie|stitch|unicorn|minecraft|peppa)/i) ||
                    msg.match(/\blocati|\borasul|\brestaurant|\bsala|\badresa/i)
                ) && toolCalls.length === 0; // doar dacă nu am făcut deja un tool call în iterație

                if (hasEventDetails || wantsChange || wantsNameChange || hasPartialDetails) {
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
        if (!response.functionCalls && response.text) {
            const parsedFn = parseFunctionCallFromText(response.text);
            if (parsedFn) {
                console.log(`[VertexAI] Detected function call in text output — executing: ${parsedFn.name}`);
                response.functionCalls = [parsedFn];
            }
        }

        // If AI responds with text (no function calls), we're done
        if (!response.functionCalls || response.functionCalls.length === 0) {
            finalReply = cleanReply(response.text) || 'Am notat! ✅';
            break;
        }

        const currentIterCalls = [...response.functionCalls];
        const iterResults = [];

        // Execute ALL function calls in parallel/sequence
        for (const fn of currentIterCalls) {
            const { name, args } = fn;
            console.log(`[VertexAI] Tool call #${i + 1} (Parallel): ${name}`);
            
            // Deduplicate redundant tool calls generated by LLM reasoning loops
            let isDuplicate = false;
            if (name === 'noteaza_petrecere' || name === 'actualizeaza_petrecere' || name === 'NoteazaPetrecereEventDetails') {
                const currentRole = (args.role_title || '').toLowerCase().trim();
                const currentDetailsStr = JSON.stringify(args.event_details || {});
                
                const getChar = (obj) => {
                    if (!obj) return '';
                    return (obj['Personajul Dorit'] || obj['PersonajulDorit'] || obj['Personajul_Dorit'] || obj['Personaj'] || obj['Personajul'] || obj['Personajul_dorit'] || '').toLowerCase().trim();
                };
                const currentChar = getChar(args.event_details);

                for (const prev of toolCalls) {
                    if (prev.name === name) {
                        const prevRole = (prev.args.role_title || '').toLowerCase().trim();
                        const prevDetailsStr = JSON.stringify(prev.args.event_details || {});
                        const prevChar = getChar(prev.args.event_details);

                        // Caz 1: role_title + event_details identice (exact duplicate)
                        if (currentRole && prevRole && currentRole === prevRole && currentDetailsStr === prevDetailsStr) {
                            isDuplicate = true;
                            break;
                        }
                        // Caz 2: acelasi personaj + acelasi rol (variantă cu chei diferite în event_details)
                        if (currentChar && prevChar && currentChar === prevChar && currentRole && prevRole && currentRole === prevRole) {
                            isDuplicate = true;
                            break;
                        }
                    }
                }
            }

            let fnResult;
            if (isDuplicate) {
                console.log(`[VertexAI] ⛔ Prevented duplicate tool call for role: ${args.role_title}`);
                fnResult = { success: true, message: "Am notat deja acest personaj/detaliu. Nu mai apela funcția pentru el." };
            } else {
                console.log(`[VertexAI] Executing function: ${name}`, JSON.stringify(args).substring(0, 200));
                fnResult = await executeFunctionCall(fn, session.id, phoneE164, options);
            }
            
            lastFunctionCall = fn;
            lastFunctionResult = fnResult;
            toolCalls.push({ name, args, result: fnResult });
            iterResults.push({ name, args, result: fnResult, isDuplicate });

            // Save to DB
            if (!isDuplicate && !isSim) {
                await saveMessage(session.id, 'function_call', null, { functionName: name, functionArgs: args }, options);
                await saveMessage(session.id, 'function_response', JSON.stringify(fnResult), { functionName: name, functionResult: fnResult }, options);
            }
        }

        // Feed results back to AI — smart continuation based on context
        
        let continuationPrompt = cfg.prompt_continuation_default || 'Continuă apelurile';

        
        // Use the last non-duplicate result for specific continuation prompt rules
        const validResults = iterResults.filter(r => !r.isDuplicate && r.name === 'cauta_petreceri' && r.result.events?.length > 0);
        if (validResults.length > 0) {
            const eventId = validResults[validResults.length - 1].result.events[0].id;
            const msg = userMessageText.toLowerCase();
            if (msg.includes('anulez') || msg.includes('renunt')) {
                continuationPrompt = `IMPORTANT: Clientul vrea să ANULEZE. Apelează ACUM anuleaza_petrecere cu event_id="${eventId}". NU confirma verbal, execută tool-ul.`;
            } else if (msg.includes('reactivez') || msg.includes('restaur') || msg.includes('razgandit')) {
                continuationPrompt = `IMPORTANT: Clientul vrea să REACTIVEZE. Apelează ACUM restaureaza_petrecere cu event_id="${eventId}". NU confirma verbal, execută tool-ul.`;
            } else {
                continuationPrompt = `IMPORTANT: Clientul a cerut: "${userMessageText}". Petrecerea are event_id="${eventId}". Apelează ACUM actualizeaza_petrecere cu event_id="${eventId}" și event_details cu câmpurile ce trebuie modificate. NU răspunde verbal fără tool!`;
            }
        }

        const modelContentParams = currentIterCalls.map(fn => `[Funcția ${fn.name} apelată cu parametri: ${JSON.stringify(fn.args)}]`).join('\n');
        const userContentResults = `Rezultate:\n` + iterResults.map(r => `[Rezultat pt ${r.name}: ${JSON.stringify(r.result)}]`).join('\n') + `\n\n${continuationPrompt}`;

        currentMessages = [
            ...currentMessages,
            { role: 'model', content: modelContentParams },
            { role: 'user', content: userContentResults }
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
        functionCalls: toolCalls.length > 0 ? toolCalls : null,
        debug: {
            functionCalls: toolCalls,
            latencyMs
        },
        latencyMs
    };
}

// ─── Exports ───
export { loadSystemPrompt, callVertexAI, getOrCreateSession, vertexDb, loadVertexConfig };
