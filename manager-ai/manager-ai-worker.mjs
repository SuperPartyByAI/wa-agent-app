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
let LLM_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

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
            console.log(`[AI Worker] No unsimulated real client messages found for ${conversation_id}.`);
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
            const clientData = await supabase.from('client_notebooks').select('phone_number').eq('client_id', convData?.data?.client_id).single();
            const phoneE164 = clientData?.data?.phone_number || conversation_id;
            
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
            // Scan the 50 most recently active conversations
            const { data: convs, error: listErr } = await supabase
                .from('conversations')
                .select('id')
                .order('updated_at', { ascending: false })
                .limit(50);
                
            if (listErr) {
                console.error("[AI Worker Sync] Failed to scan conversations table:", listErr.message);
            } else if (convs) {
                for (const c of convs) {
                    await processConversation(c.id);
                }
            }
        } catch (e) {
            console.error("[AI Worker Sync] Global daemon error:", e.message);
        }
        
        // Rest for 10 seconds before the next sweep
        await new Promise(resolve => setTimeout(resolve, 10000));
    }
}

// Instantiate the loop if the script is run natively by PM2
import { fileURLToPath } from 'url';
if (process.argv[1] === fileURLToPath(import.meta.url)) {
    startSyncDaemon();
}
