import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import dotenv from 'dotenv';
import { processWithVertexAI } from './src/vertex/vertexClient.mjs';
dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// LLM config — Gemini 2.5 Flash
const GEMINI_API_KEY = process.env.VERTEX_AI_API_KEY || process.env.GEMINI_API_KEY;
let LLM_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash-preview-04-17';

// Removed strict model check to allow newer models to run seamlessly.

// Safety switch — AI auto-reply kill switch
const AI_AUTOREPLY_ENABLED = process.env.AI_AUTOREPLY_ENABLED === 'true';

// whts-up transport config for auto-send
const WHTSUP_API_URL = process.env.WHTSUP_API_URL || 'http://5.161.179.132:3000';
const WHTSUP_API_KEY = process.env.WHTSUP_API_KEY || process.env.API_KEY;

// ─────────────────────────────────────────
// SERVICE CATALOG — loaded once at startup
// ─────────────────────────────────────────
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SERVICE_CATALOG = JSON.parse(readFileSync(join(__dirname, 'service-catalog.json'), 'utf8'));

// Build a concise catalog summary for the LLM prompt
function buildCatalogPromptBlock() {
    return SERVICE_CATALOG.services.map(s =>
        `- ${s.service_key} (${s.display_name}): ${s.description}\n  Campuri obligatorii: ${s.required_fields.join(', ')}\n  Campuri optionale: ${s.optional_fields.join(', ')}`
    ).join('\n');
}

const CATALOG_BLOCK = buildCatalogPromptBlock();
const SERVICE_KEYS = SERVICE_CATALOG.services.map(s => s.service_key);

console.log(`[Service Catalog] Loaded ${SERVICE_CATALOG.services.length} services (v${SERVICE_CATALOG.version}): ${SERVICE_KEYS.join(', ')}`);

/**
 * Calls the Google Gemini API.
 */
async function callLocalLLM(systemPrompt, userMessage) {
    if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not set');
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${LLM_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
    
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 60000);
        
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                systemInstruction: { parts: [{ text: systemPrompt }] },
                contents: [{ role: 'user', parts: [{ text: userMessage }] }],
                generationConfig: {
                    temperature: 0.1,
                    responseMimeType: "application/json"
                }
            }),
            signal: controller.signal
        });
        
        clearTimeout(timeout);
        
        if (!response.ok) {
            throw new Error(`Gemini HTTP ${response.status}: ${await response.text()}`);
        }
        
        const data = await response.json();
        const content = data.candidates?.[0]?.content?.parts?.[0]?.text;
        
        if (!content) throw new Error('Empty Gemini response');
        
        return JSON.parse(content);
    } catch (err) {
        console.error(`[AI Worker] Gemini call failed:`, err.message);
        return null;
    }
}

// ─────────────────────────────────────────
// SYSTEM PROMPT — service-aware
// ─────────────────────────────────────────
const SYSTEM_PROMPT = `Esti asistentul AI al Superparty — companie de organizare evenimente si petreceri.
Analizeaza conversatia WhatsApp de mai jos dintre echipa noastra (Superparty) si un Client.
Extrage detaliile principale folosind DOAR informatiile explicite din conversatie. Nu inventa nimic.

IMPORTANT: Toate valorile text din JSON TREBUIE sa fie in limba ROMANA.

=== CATALOGUL NOSTRU DE SERVICII ===
${CATALOG_BLOCK}
=== SFARSIT CATALOG ===

SARCINA TA:
1. Identifica ce SERVICII din catalogul nostru sunt cerute sau mentionate in conversatie.
2. Pentru fiecare serviciu detectat, extrage campurile obligatorii completate sau pune null daca lipsesc.
3. Calculeaza ce campuri lipsesc PER SERVICIU.
4. Sugereaza cross-sell bazat pe serviciile detectate.
5. Genereaza un raspuns sugerat care cere fix informatiile lipsa pentru serviciile detectate.

Returneaza un obiect JSON STRICT conform acestui format:
{
  "client_memory": {
    "priority_level": "normal|ridicat|urgent",
    "internal_notes_summary": "Rezumat scurt 1-2 propozitii"
  },
  "event_draft": {
    "draft_type": "petrecere_standard",
    "structured_data": {
      "location": "locatia extrasa sau null",
      "date": "data extrasa sau null",
      "event_type": "tipul extras sau null"
    },
    "missing_fields": ["lista generala de informatii lipsa"]
  },
  "selected_services": ["service_key_1", "service_key_2"],
  "service_requirements": {
    "service_key_1": {
      "extracted_fields": {"camp1": "valoare", "camp2": null},
      "missing_fields": ["camp2"],
      "status": "complet|partial|necunoscut"
    }
  },
  "missing_fields_per_service": {
    "service_key_1": ["camp2"]
  },
  "cross_sell_opportunities": ["service_key_3"],
  "conversation_state": {
    "current_intent": "Ce doreste clientul in acest moment?",
    "next_best_action": "Ce ar trebui sa raspunda operatorul?"
  },
  "suggested_reply": "Textul exact pe care operatorul il poate trimite clientului. Cere SPECIFIC informatiile lipsa pentru serviciile detectate. Scrie ca si cum esti operatorul Superparty: profesional, cald, prietenos. Salut cu Buna!, nu cu Buna ziua. Foloseste emoji-uri subtile. Max 3-4 propozitii.",
  "decision": {
    "can_auto_reply": false,
    "needs_human_review": true,
    "escalation_reason": null,
    "confidence_score": 0,
    "conversation_stage": "lead"
  }
}

REGULI IMPORTANTE:
- "selected_services" contine DOAR service_key-uri din catalogul de mai sus
- Daca nu detectezi niciun serviciu concret, pune "selected_services": []
- "service_requirements" contine cate un obiect pentru fiecare serviciu din selected_services
- "missing_fields" per serviciu = campurile obligatorii din catalog care NU au fost completate
- "cross_sell_opportunities" = servicii complementare din catalog care nu au fost cerute dar merg bine cu cele selectate
- "suggested_reply" trebuie sa ceara fix informatiile lipsa per serviciu, nu generic

REGULI PENTRU "decision":
- "conversation_stage" poate fi: "lead", "qualifying", "quoting", "booking", "payment", "coordination", "completed", "escalation"
- "confidence_score" intre 0-100
- "can_auto_reply" = true DOAR daca: mesajul este simplu, confidence >= 75, NU exista conflict
- "needs_human_review" = true daca: negociere pret, cerere om, situatie ambigua, confidence < 60
- "escalation_reason" se completeaza cand: nemultumire, conflict, aspect juridic/financiar sensibil`;

// ─────────────────────────────────────────
// RETROACTIVE EXTRACTION — prompt & helper
// ─────────────────────────────────────────
// Role sources cache
let _roleSourcesCache = null;
let _roleSourcesLastLoad = 0;

async function loadRoleSources() {
    const now = Date.now();
    if (_roleSourcesCache && now - _roleSourcesLastLoad < 5 * 60 * 1000) return _roleSourcesCache;
    try {
        const r = await fetch('http://localhost:3005/api/vertex/sources?brand=GLOBAL');
        const d = await r.json();
        _roleSourcesCache = (d.sources || []).map(src => {
            const lines = (src.content || '').split('\n');
            let serviciu = '', taguri = [], detalii = [];
            for (const l of lines) {
                const ll = l.toLowerCase();
                if (ll.startsWith('serviciu:')) serviciu = l.split(':').slice(1).join(':').trim();
                else if (ll.startsWith('tag-uri:')) taguri = l.split(':').slice(1).join(':').trim().split(',').map(t => t.trim().toLowerCase());
                else if (ll.includes('obligatorii')) detalii = l.split(':').slice(1).join(':').trim().split(',').map(ff => ff.trim()).filter(Boolean);
            }
            return { serviciu, taguri, detalii };
        }).filter(s => s.serviciu);
        _roleSourcesLastLoad = now;
        console.log(`[Worker] Loaded ${_roleSourcesCache.length} role sources`);
    } catch(e) { console.warn('[Worker] Could not load role sources:', e.message); }
    return _roleSourcesCache || [];
}

function getMandatoryFields(sources, roleTitle) {
    const lower = (roleTitle || '').toLowerCase();
    const match = sources.find(s =>
        s.serviciu.toLowerCase().includes(lower) ||
        s.taguri.some(t => lower.includes(t) || t.includes(lower))
    );
    return match ? match.detalii : [];
}

async function buildExtractionPrompt() {
    const sources = await loadRoleSources();
    // Build comprehensive field list from all roles
    const allFields = new Set([
        'Data Evenimentului', 'Ora de Inceput', 'Locatia', 'Personajul Dorit',
        'Numar Copii', 'Durata (ore)', 'Nume Sarbatorit', 'Varsta Sarbatorit',
        'Data Nasterii Sarbatorit', 'Metoda de Plata (Cash/Card)', 'Situatie Incasare',
        'Numar Invitati', 'Culori Baloane', 'Dimensiune Arcada', 'Tip Locatie', 'Ocazie'
    ]);
    for (const src of sources) {
        for (const ff of src.detalii) allFields.add(ff);
    }
    const roleNames = [...new Set(sources.map(s => s.serviciu.split('(')[0].trim()))].join(', ');
    const fieldsJson = [...allFields].map(ff => `      "${ff}": "valoarea din conversatie sau null"`).join(',\n');
    return `Esti un extractor de date pentru Superparty.
Analizezi o conversatie WhatsApp si extragi detaliile evenimentului cerut.
Nu inventa NIMIC. Extrage DOAR ce e explicit mentionat.

Roluri posibile: ${roleNames}

Returneaza JSON:
{
  "has_event": true,
  "servicii": [
    {
      "role_title": "numele rolului cerut (ex: Animatie, Popcorn, Ursitoare)",
${fieldsJson}
    }
  ]
}
Daca nu e niciun eveniment concret, returneaza {"has_event": false, "servicii": []}.
Daca sunt mai multe servicii, listeaza-le separat.`;
}

// Will be loaded dynamically on first use
let RETROACTIVE_EXTRACT_PROMPT_DYNAMIC = null;
async function getExtractionPrompt() {
    if (!RETROACTIVE_EXTRACT_PROMPT_DYNAMIC) {
        RETROACTIVE_EXTRACT_PROMPT_DYNAMIC = await buildExtractionPrompt();
    }
    return RETROACTIVE_EXTRACT_PROMPT_DYNAMIC;
}

/**
 * Builds a synthetic message from LLM-extracted service data
 * so that processWithVertexAI can call noteaza_petrecere with correct fields.
 */
function buildSyntheticMessage(extraction) {
    if (!extraction?.servicii?.length) return null;
    
    const parts = extraction.servicii.map(s => {
        const tokens = [];
        if (s.role_title) tokens.push(s.role_title);
        // Support both old English keys and new Romanian keys
        const personaj = s['Personajul Dorit'] || s.personaj;
        const data = s['Data Evenimentului'] || s.data;
        const ora = s['Ora de Inceput'] || s['Ora de Început'] || s.ora_start;
        const loc = s['Locatia'] || s['Locația'] || s.locatie;
        const durata = s['Durata (ore)'] || s.durata;
        const copii = s['Numar Copii'] || s['Număr Copii'] || s.nr_copii;
        const numeSarb = s['Nume Sarbatorit'] || s['Nume Sărbătorit'] || s.nume_sarbatorit;
        const varsta = s['Varsta Sarbatorit'] || s['Vârsta Sărbătorit'] || s.varsta;
        if (personaj) tokens.push(`cu ${personaj}`);
        if (data) tokens.push(`pe ${data}`);
        if (ora) tokens.push(`la ora ${ora}`);
        if (loc) tokens.push(`la ${loc}`);
        if (durata) tokens.push(`${durata} ore`);
        if (copii) tokens.push(`${copii} copii`);
        if (numeSarb) tokens.push(`sarbatorit: ${numeSarb}`);
        if (varsta) tokens.push(`varsta ${varsta} ani`);
        // Include any other non-null Romanian fields as notes
        const extraFields = Object.entries(s).filter(([k,v]) => 
            !['role_title','personaj','data','ora_start','locatie','durata','nr_copii','nume_sarbatorit','varsta','notes',
              'Personajul Dorit','Data Evenimentului','Ora de Inceput','Ora de Inceput','Locatia','Locatia',
              'Durata (ore)','Numar Copii','Numar Copii','Nume Sarbatorit','Nume Sarbatorit','Varsta Sarbatorit','Varsta Sarbatorit'
            ].includes(k) && v && v !== 'null'
        );
        for (const [k,v] of extraFields) tokens.push(`${k}: ${v}`);
        return tokens.join(', ');
    }).filter(Boolean);
    
    if (!parts.length) return null;
    return `Buna ziua, vreau sa rezerv: ${parts.join(' | ')}`;
}

/**
 * Send a message to WhatsApp via the whts-up transport API.
 */
async function sendViaWhatsApp(conversationId, text) {
    const { data: conv } = await supabase.from('conversations').select('session_id').eq('id', conversationId).single();
    if (!conv?.session_id) {
        console.error('[AI AutoSend] No session_id found for conversation', conversationId);
        return false;
    }

    try {
        const response = await fetch(`${WHTSUP_API_URL}/api/messages/send`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': WHTSUP_API_KEY
            },
            body: JSON.stringify({
                sessionId: conv.session_id,
                conversationId: conversationId,
                text: text,
                message_type: 'text'
            })
        });

        if (!response.ok) {
            const err = await response.text();
            console.error('[AI AutoSend] whts-up API error:', err);
            return false;
        }

        console.log(`[AI AutoSend] Message sent for conversation ${conversationId}`);
        return true;
    } catch (err) {
        console.error('[AI AutoSend] Network error:', err.message);
        return false;
    }
}

// ─────────────────────────────────────────
// POST-PROCESSING: validate & enrich service data using catalog
// ─────────────────────────────────────────
function postProcessServices(analysis) {
    const catalogMap = {};
    SERVICE_CATALOG.services.forEach(s => { catalogMap[s.service_key] = s; });

    // Validate selected_services against catalog
    const rawSelected = analysis.selected_services || [];
    const validSelected = rawSelected.filter(key => catalogMap[key]);
    
    // Build precise missing_fields_per_service from catalog
    const missingPerService = {};
    const serviceReqs = analysis.service_requirements || {};
    
    for (const key of validSelected) {
        const catalogEntry = catalogMap[key];
        const extracted = serviceReqs[key]?.extracted_fields || {};
        
        // Missing = required fields from catalog that are null/undefined/empty in extracted
        const missing = catalogEntry.required_fields.filter(field => {
            const val = extracted[field];
            return val === null || val === undefined || val === '' || val === 'null';
        });
        
        missingPerService[key] = missing;
    }
    
    // Build cross-sell from catalog (services not selected but linked)
    const crossSell = new Set();
    for (const key of validSelected) {
        const catalogEntry = catalogMap[key];
        for (const linked of (catalogEntry.cross_sell_services || [])) {
            if (!validSelected.includes(linked) && catalogMap[linked]) {
                crossSell.add(linked);
            }
        }
    }
    
    // Check human_review_triggers
    let shouldForceReview = false;
    for (const key of validSelected) {
        const catalogEntry = catalogMap[key];
        if (!catalogEntry.autonomy_allowed) {
            shouldForceReview = true;
        }
    }
    
    return {
        selected_services: validSelected,
        missing_fields_per_service: missingPerService,
        cross_sell_opportunities: [...crossSell],
        should_force_review: shouldForceReview,
        catalog_map: catalogMap
    };
}

// ─────────────────────────────────────────
// MAIN: processConversation
// ─────────────────────────────────────────
export async function processConversation(conversation_id, message_id = null, operator_prompt = null) {
    if (!conversation_id) return;
    
    // Human takeover detection: skip if agent responded in last 15 min
    try {
        const cutoff = new Date(Date.now() - 15 * 60 * 1000).toISOString();
        const { data: agentMsgs } = await supabase.from('messages')
            .select('id').eq('conversation_id', conversation_id)
            .eq('sender_type', 'agent').gte('created_at', cutoff).limit(1);
        if (agentMsgs && agentMsgs.length > 0) {
            console.log(`[AI Worker] SKIP - Human agent active in conv ${conversation_id} (last 15 min)`);
            return;
        }
    } catch(e) { console.warn('[AI Worker] Takeover check error:', e.message); }

    console.log(`[AI Worker] Starting text-understanding pipeline for ${conversation_id}...`);

    try {
        // 1. Fetch REAL client messages (chronological)
        const { data: realMessages, error: realErr } = await supabase
            .from('messages')
            .select('content, direction, created_at, sender_type')
            .eq('conversation_id', conversation_id)
            .eq('sender_type', 'client')
            .order('created_at', { ascending: true });

        if (realErr) throw new Error(`Failed to fetch real client messages: ${realErr.message}`);
        
        // 2. Fetch SHADOW messages
        const { data: shadowMessages, error: shadowErr } = await supabase
            .from('ai_training_messages')
            .select('content, sender_type, created_at')
            .eq('conversation_id', conversation_id)
            .order('created_at', { ascending: true });

        if (shadowErr) throw new Error(`Failed to fetch shadow messages: ${shadowErr.message}`);

        const shadowClientCount = shadowMessages ? shadowMessages.filter(m => m.sender_type === 'client').length : 0;
        const realClientCount = realMessages ? realMessages.length : 0;
        
        let currentShadow = [...(shadowMessages || [])];
        const missingClientMessages = realClientCount > shadowClientCount ? realMessages.slice(shadowClientCount) : [];
        
        if (missingClientMessages.length === 0) {
            console.log(`[AI Worker] No unsimulated real client messages found for ${conversation_id}. Checking for missing events...`);
            
            // ── PIPELINE 2: Retroactive extraction ──────────────────────────────
            // Shadow is up-to-date but we may still have 0 events in ai_client_events.
            // In that case, run LLM on full conversation and call Vertex with a
            // synthetic message so noteaza_petrecere saves the events.
            try {
                const { data: convMeta } = await supabase
                    .from('conversations').select('client_id').eq('id', conversation_id).single();
                const clientId = convMeta?.client_id;
                if (!clientId) return;

                const { data: existingEvents } = await supabase
                    .from('ai_client_events')
                    .select('id, data_eveniment')
                    .eq('client_id', clientId)
                    .limit(1);

                // Skip only if events exist WITH a confirmed date (fully populated)
                const hasCompleteEvent = existingEvents?.some(e => e.data_eveniment);
                if (existingEvents && existingEvents.length > 0 && hasCompleteEvent) {
                    return;
                }

                console.log(`[AI Worker Retro] Client ${clientId} has 0 events. Running retroactive extraction for conv ${conversation_id}...`);

                // Fetch full conversation (client + operator) for context
                const { data: allMsgs } = await supabase
                    .from('messages')
                    .select('content, sender_type, created_at')
                    .eq('conversation_id', conversation_id)
                    .order('created_at', { ascending: true })
                    .limit(60);

                if (!allMsgs || allMsgs.length < 2) return;

                const convText = allMsgs.map(m => {
                    const who = m.sender_type === 'client' ? 'CLIENT' : 'OPERATOR';
                    return `${who}: ${m.content}`;
                }).join('\n');

                const extraction = await callLocalLLM(await getExtractionPrompt(), convText);
                if (!extraction || !extraction.has_event || !extraction.servicii?.length) {
                    console.log(`[AI Worker Retro] No event found in conv ${conversation_id}. Skipping.`);
                    return;
                }

                const syntheticMsg = buildSyntheticMessage(extraction);
                if (!syntheticMsg) {
                    console.log(`[AI Worker Retro] Could not build synthetic message for conv ${conversation_id}.`);
                    return;
                }

                const { data: clientData } = await supabase
                    .from('clients').select('real_phone_e164').eq('id', clientId).single();
                const phoneE164 = clientData?.real_phone_e164;
                if (!phoneE164) {
                    console.log(`[AI Worker Retro] No phone for client ${clientId}. Skipping.`);
                    return;
                }

                // ── Direct DB Update: fill in structured fields from LLM extraction ──
                for (const svc of extraction.servicii) {
                    try {
                        const vtxSupa = (await import('@supabase/supabase-js')).createClient(
                            process.env.VERTEX_SUPABASE_URL, process.env.VERTEX_SUPABASE_SERVICE_ROLE_KEY
                        );
                        const roleTitle = svc.role_title || 'Animatie';
                        // Dynamic: use ALL fields from LLM extraction as event_details keys
                        // The dynamic prompt returns Romanian field names directly from vertex_sources
                        const SKIP = new Set(['role_title', 'has_event']);
                        const ENGLISH_TO_RO = {
                            'data': 'Data Evenimentului', 'ora_start': 'Ora de Inceput',
                            'locatie': 'Locatia', 'durata': 'Durata (ore)', 'personaj': 'Personajul Dorit',
                            'nr_copii': 'Numar Copii', 'varsta': 'Varsta Sarbatorit',
                            'nume_sarbatorit': 'Nume Sarbatorit', 'notes': 'Note'
                        };
                        const eventDetails = {};
                        for (const [k, v] of Object.entries(svc)) {
                            if (SKIP.has(k) || !v || v === 'null') continue;
                            const key = ENGLISH_TO_RO[k] || k;
                            eventDetails[key] = v;
                        }
                        const { data: exEv } = await vtxSupa.from('client_events')
                            .select('id, event_details').eq('client_phone', phoneE164)
                            .eq('role_title', roleTitle).eq('status', 'active').maybeSingle();
                        if (exEv) {
                            const merged = { ...(exEv.event_details || {}) };
                            for (const [k, v] of Object.entries(eventDetails)) {
                                if (v !== null && v !== undefined) merged[k] = v;
                            }
                            await vtxSupa.from('client_events').update({ event_details: merged }).eq('id', exEv.id);
                        } else {
                            await vtxSupa.from('client_events').insert({
                                client_phone: phoneE164, role_title: roleTitle,
                                event_details: eventDetails, total_amount: 0, notes: '', status: 'active'
                            });
                        }
                        console.log(`[AI Worker Retro] ✅ Synced ${roleTitle} to Vertex for ${phoneE164}`);
                    } catch(vtxErr) {
                        console.warn(`[AI Worker Retro] Vertex sync failed:`, vtxErr.message);
                    }
                }

                // Also update ai_client_events data fields if first service has data
                const firstSvc = extraction.servicii[0];
                if (firstSvc?.data) {
                    await supabase.from('ai_client_events')
                        .update({ data_eveniment: firstSvc.data, locatie: firstSvc.locatie, ora_eveniment: firstSvc.ora_start })
                        .eq('client_id', clientId);
                }

                console.log(`[AI Worker Retro] Injecting synthetic: "${syntheticMsg.substring(0, 120)}"`);
                await processWithVertexAI(phoneE164, syntheticMsg);
                console.log(`[AI Worker Retro] ✅ Retroactive extraction done for conv ${conversation_id} (client ${clientId})`);

            } catch (retroErr) {
                console.error(`[AI Worker Retro] Retroactive extraction failed for ${conversation_id}:`, retroErr.message);
            }
            return;
        }

        console.log(`[AI Worker] Found ${missingClientMessages.length} unsimulated messages. Starting step-by-step shadow iteration.`);

        // Iterate over each individual unsimulated client message chronologically
        for (const msg of missingClientMessages) {
            console.log(`[AI Worker Sync] Backfilling missed message into Vertex AI: "${msg.content.substring(0, 30)}..."`);
            
            // 1. Force insert missed client message into Shadow DB!
            const newShadow = {
                conversation_id,
                sender_type: 'client',
                content: msg.content,
                created_at: msg.created_at
            };
            const { error: insErr } = await supabase.from('ai_training_messages').insert(newShadow);
            if (insErr) console.error("[AI Worker Sync] Failed to backfill real msg to shadow:", insErr.message);

            // 2. Query REAL Vertex AI engine with the clean missing prompt
            const convData = await supabase.from('conversations').select('client_id').eq('id', conversation_id).single();
            const clientData = await supabase.from('clients').select('real_phone_e164').eq('id', convData?.data?.client_id).single();
            const phoneE164 = clientData?.data?.real_phone_e164 || conversation_id;
            
            console.log(`[AI Worker Sync] Pinging Vertex processing array for ${phoneE164} on catch-up thread...`);
            let vertexResult;
            try {
                vertexResult = await processWithVertexAI(phoneE164, msg.content);
            } catch (err) {
                 console.error("[AI Worker Sync] Vertex failed natively:", err.message);
                 vertexResult = { reply: "Eroare temporară la sincronizarea retroactive." };
            }
            
            const reply = vertexResult?.reply || "Eveniment sincronizat retrospectiv fără răspuns verbal.";

            // 3. Immediately insert Decision Metadata so UI binds securely (Col 3 works)
            await supabase.from('ai_reply_decisions').insert({
                conversation_id,
                suggested_reply: reply,
                can_auto_reply: false,
                needs_human_review: true,
                confidence_score: 99,
                conversation_stage: 'vertex-background-sync',
                reply_status: 'shadow_sync',
                sent_by: 'ai_worker_sync',
                created_at: new Date().toISOString()
            });

            // 4. Force AI output into Simulator history so it renders!
            const aiRecordTime = new Date(new Date(msg.created_at).getTime() + 1000).toISOString();
            const aiShadowMsg = {
                conversation_id,
                sender_type: 'ai',
                content: reply,
                created_at: aiRecordTime
            };
            await supabase.from('ai_training_messages').insert(aiShadowMsg);

            console.log(`[AI Worker Sync] Successfully healed drift for interaction: ${msg.id}`);
        }
        
        // We bypass the entirety of the archaic legacy local processing loop below!
        return;

        // 6. Generate service-aware dynamic layout JSON for Android
        const escalationBadge = decision.escalation_reason ? `Escaladare: ${decision.escalation_reason}` : null;
        
        const dynamicSchema = [
            // Status badge
            {
                type: "status_badge",
                items: [
                    { label: "Incredere AI", value: `${decision.confidence_score}%` },
                    { label: "Etapa", value: decision.conversation_stage },
                    ...(escalationBadge ? [{ label: "Escaladare", value: decision.escalation_reason }] : [])
                ]
            },
            // Rezumat card
            {
                type: "card",
                title: "Creier AI - Rezumat",
                items: [
                    { label: "Prioritate", value: clientMemory.priority_level },
                    { label: "Intent", value: convState.current_intent }
                ]
            }
        ];

        // Service list — chips with detected services
        if (serviceData.selected_services.length > 0) {
            dynamicSchema.push({
                type: "service_list",
                title: "Servicii Detectate",
                items: serviceData.selected_services.map(key => {
                    const catalogEntry = serviceData.catalog_map[key];
                    const missing = serviceData.missing_fields_per_service[key] || [];
                    const status = missing.length === 0 ? 'complet' : `${missing.length} lipsa`;
                    return { label: catalogEntry?.display_name || key, value: status };
                })
            });

            // Service missing cards — one per service with missing fields
            for (const key of serviceData.selected_services) {
                const catalogEntry = serviceData.catalog_map[key];
                const missing = serviceData.missing_fields_per_service[key] || [];
                const extracted = analysis.service_requirements?.[key]?.extracted_fields || {};
                
                if (missing.length > 0) {
                    dynamicSchema.push({
                        type: "service_missing_card",
                        title: `${catalogEntry?.display_name || key} - Lipsuri`,
                        items: [
                            ...missing.map(f => ({ label: f, value: "lipsa" })),
                            ...Object.entries(extracted)
                                .filter(([, v]) => v && v !== 'null')
                                .map(([k, v]) => ({ label: k, value: String(v) }))
                        ]
                    });
                }
            }

            // Cross-sell card
            if (serviceData.cross_sell_opportunities.length > 0) {
                dynamicSchema.push({
                    type: "cross_sell_card",
                    title: "Sugestii Suplimentare",
                    text: "Servicii complementare pe care le puteti oferi clientului:",
                    items: serviceData.cross_sell_opportunities.map(key => {
                        const entry = serviceData.catalog_map[key];
                        return { label: entry?.display_name || key, value: entry?.description || '' };
                    })
                });
            }
        }

        // Draft Eveniment card (general)
        dynamicSchema.push({
            type: "card",
            title: "Draft Eveniment",
            items: [
                { label: "Tip", value: eventDraft.structured_data?.event_type || "Nespecificat" },
                { label: "Locatie", value: eventDraft.structured_data?.location || "Nespecificat" },
                { label: "Data", value: eventDraft.structured_data?.date || "Nespecificat" }
            ]
        });

        // Suggested Reply card
        dynamicSchema.push({
            type: "reply_card",
            title: replyStatus === 'sent' ? "Raspuns Trimis de AI" : "Raspuns Propus",
            text: suggestedReply,
            items: [
                { label: "Status", value: replyStatus === 'sent' ? "Trimis automat" : "Asteapta confirmare" }
            ],
            action: "inject_reply",
            action_payload: suggestedReply
        });

        // Prompt input
        dynamicSchema.push({
            type: "prompt_input",
            title: "Instructiune Operator",
            text: "Scrie o instructiune pentru AI (ex: raspunde mai cald, intreaba de numarul de copii)",
            action: "send_prompt"
        });

        // General missing fields
        const generalMissing = eventDraft.missing_fields || [];
        if (generalMissing.length > 0) {
            dynamicSchema.push({
                type: "form_card",
                title: "Trebuie sa aflam:",
                items: generalMissing.map(f => ({ label: f, value: "" }))
            });
        }

        const { error: err4 } = await supabase.from('ai_ui_schemas').insert({
            conversation_id: conversation_id,
            screen_type: 'brain_tab',
            layout_json: dynamicSchema
        });
        if (err4) console.error("[AI Worker] DB Error schemas:", err4.message);

        console.log(`[AI Worker] Successfully processed ${conversation_id}. Services: ${serviceData.selected_services.length}, Reply: ${replyStatus}, Confidence: ${decision.confidence_score}%`);

    } catch (error) {
        console.error(`[AI Worker] Critical failure:`, error);
    }
}

// ─────────────────────────────────────────
// 🚀 PRODUCTION BACKGROUND DAEMON (10s Polling)
// ─────────────────────────────────────────
async function startSyncDaemon() {
    console.log("[AI Worker Sync] Starting infinite Vertex AI Sandbox backfill loop...");
    while (true) {
        try {
            // Scan only the 30 most recently ACTIVE conversations (updated in last 24h)
            // to keep egress low. Older conversations are already fully processed.
            const activeCutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
            const { data: convs, error: listErr } = await supabase
                .from('conversations')
                .select('id')
                .gte('updated_at', activeCutoff)
                .order('updated_at', { ascending: false })
                .limit(30);
                
            if (listErr) {
                console.error("[AI Worker Sync] Failed to scan conversations table:", listErr.message);
            } else if (convs) {
                console.log(`[AI Worker Sync] Scanning ${convs.length} active conversations...`);
                for (const c of convs) {
                    await processConversation(c.id);
                }
            }
        } catch (e) {
            console.error("[AI Worker Sync] Global daemon error:", e.message);
        }
        
        // Rest for 60 seconds before the next sweep (reduces API calls by 6x vs 10s)
        await new Promise(resolve => setTimeout(resolve, 60000));
    }
}

// Instantiate the loop if the script is run natively by PM2 or CLI
const isMain = process.argv[1]?.endsWith('manager-ai-worker.mjs') || process.env.pm_id !== undefined;
if (isMain) {
    startSyncDaemon();
}
