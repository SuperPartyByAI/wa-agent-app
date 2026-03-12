import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// Local LLM config — Ollama (self-hosted, zero external API cost)
const LLM_BASE_URL = process.env.LOCAL_LLM_BASE_URL || 'http://localhost:11434';
const LLM_MODEL = process.env.LOCAL_LLM_MODEL || 'qwen2.5:7b';

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
 * Calls the local Ollama server via the OpenAI-compatible /v1/chat/completions endpoint.
 */
async function callLocalLLM(systemPrompt, userMessage) {
    const url = `${LLM_BASE_URL}/v1/chat/completions`;
    
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 180000); // 3min for bigger prompt with catalog
        
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: LLM_MODEL,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userMessage }
                ],
                temperature: 0.1,
                response_format: { type: 'json_object' }
            }),
            signal: controller.signal
        });
        
        clearTimeout(timeout);
        
        if (!response.ok) {
            throw new Error(`LLM HTTP ${response.status}: ${await response.text()}`);
        }
        
        const data = await response.json();
        const content = data.choices?.[0]?.message?.content;
        
        if (!content) throw new Error('Empty LLM response');
        
        return JSON.parse(content);
    } catch (err) {
        console.error(`[AI Worker] Local LLM call failed:`, err.message);
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
    
    console.log(`[AI Worker] Starting text-understanding pipeline for ${conversation_id}...`);

    try {
        // 1. Fetch conversation history
        const { data: messages, error: msgErr } = await supabase
            .from('messages')
            .select('content, direction, created_at, sender_type')
            .eq('conversation_id', conversation_id)
            .order('created_at', { ascending: false })
            .limit(50);

        if (msgErr) throw new Error(`Failed to fetch messages: ${msgErr.message}`);
        if (!messages || messages.length === 0) return;

        const transcript = messages.reverse().map(m => 
            `[${new Date(m.created_at).toISOString()}] ${m.sender_type === 'agent' ? 'Superparty (Noi)' : 'Client'}: ${m.content}`
        ).join('\n');

        // Build user message with optional operator prompt
        let userMessage = `--- CONVERSATIE ---\n${transcript}`;
        if (operator_prompt) {
            userMessage += `\n\n--- INSTRUCTIUNE OPERATOR ---\n${operator_prompt}\nAplicam instructiunea de mai sus la generarea raspunsului sugerat.`;
        }

        // 2. Call local LLM
        console.log(`[AI Worker] Calling local LLM (${LLM_MODEL}) with transcript (${transcript.length} chars)${operator_prompt ? ' + operator prompt' : ''}...`);
        
        let analysis = await callLocalLLM(SYSTEM_PROMPT, userMessage);
        
        if (!analysis) {
            console.warn(`[AI Worker] Local LLM unreachable. Using mock fallback.`);
            analysis = {
                client_memory: { priority_level: "normal", internal_notes_summary: "MOCK: Client interesat de organizare eveniment." },
                event_draft: { draft_type: "petrecere_standard", structured_data: { location: null, date: null, event_type: null }, missing_fields: ["toate detaliile"] },
                selected_services: [],
                service_requirements: {},
                missing_fields_per_service: {},
                cross_sell_opportunities: [],
                conversation_state: { current_intent: "MOCK: solicita informatii", next_best_action: "Trimite pachetele disponibile." },
                suggested_reply: "Buna! Multumim pentru interesul acordat! Va putem oferi mai multe detalii despre pachetele noastre. Ce tip de eveniment planificati?",
                decision: { can_auto_reply: false, needs_human_review: true, escalation_reason: null, confidence_score: 0, conversation_stage: "lead" }
            };
        }

        // 3. Post-process services using catalog
        const serviceData = postProcessServices(analysis);
        
        const decision = analysis.decision || { can_auto_reply: false, needs_human_review: true, escalation_reason: null, confidence_score: 0, conversation_stage: 'lead' };
        const suggestedReply = analysis.suggested_reply || analysis.conversation_state?.next_best_action || 'Nu am putut genera un raspuns.';
        
        // Ensure sub-objects exist with defaults
        const clientMemory = analysis.client_memory || { priority_level: 'normal', internal_notes_summary: 'Nu s-a putut analiza.' };
        const eventDraft = analysis.event_draft || { draft_type: 'necunoscut', structured_data: { location: null, date: null, event_type: null }, missing_fields: [] };
        const convState = analysis.conversation_state || { current_intent: 'necunoscut', next_best_action: 'necunoscut' };

        // Force human review if catalog says so
        if (serviceData.should_force_review) {
            decision.needs_human_review = true;
            decision.can_auto_reply = false;
        }

        console.log(`[AI Worker] Analysis complete. Services: [${serviceData.selected_services.join(', ')}], Missing per service: ${JSON.stringify(serviceData.missing_fields_per_service)}, Cross-sell: [${serviceData.cross_sell_opportunities.join(', ')}], Decision: auto=${decision.can_auto_reply}, review=${decision.needs_human_review}, confidence=${decision.confidence_score}, stage=${decision.conversation_stage}`);

        // 4. Upsert State into AI Core Tables
        const { data: conv } = await supabase.from('conversations').select('client_id').eq('id', conversation_id).single();
        const clientId = conv?.client_id;

        if (clientId) {
            const { error: err1 } = await supabase.from('ai_client_memory').upsert({
                client_id: clientId,
                priority_level: clientMemory.priority_level,
                internal_notes_summary: clientMemory.internal_notes_summary,
                updated_at: new Date().toISOString()
            });
            if (err1) console.error("[AI Worker] DB Error memory:", err1.message);
        }

        const { data: existingDraft } = await supabase.from('ai_event_drafts').select('id').eq('conversation_id', conversation_id).maybeSingle();
        
        let err2 = null;
        if (existingDraft) {
             const { error } = await supabase.from('ai_event_drafts').update({
                client_id: clientId,
                draft_type: eventDraft.draft_type,
                structured_data_json: eventDraft.structured_data,
                missing_fields_json: eventDraft.missing_fields,
                updated_at: new Date().toISOString()
            }).eq('id', existingDraft.id);
            err2 = error;
        } else {
             const { error } = await supabase.from('ai_event_drafts').insert({
                conversation_id: conversation_id,
                client_id: clientId,
                draft_type: eventDraft.draft_type,
                structured_data_json: eventDraft.structured_data,
                missing_fields_json: eventDraft.missing_fields,
                updated_at: new Date().toISOString()
            });
            err2 = error;
        }
        if (err2) console.error("[AI Worker] DB Error drafts:", err2.message);

        const statePayload = {
            conversation_id: conversation_id,
            current_intent: convState.current_intent,
            next_best_action: convState.next_best_action,
            updated_at: new Date().toISOString()
        };
        
        if (message_id) {
            statePayload.last_processed_message_id = message_id;
        }

        const { error: err3 } = await supabase.from('ai_conversation_state').upsert(statePayload);
        if (err3) console.error("[AI Worker] DB Error state:", err3.message);

        // 5. Save AI reply decision (audit trail)
        let replyStatus = 'pending';
        let sentBy = 'pending';
        let sentAt = null;

        if (AI_AUTOREPLY_ENABLED && decision.can_auto_reply && !decision.needs_human_review && decision.confidence_score >= 75) {
            console.log(`[AI Worker] Auto-reply conditions met (confidence=${decision.confidence_score}). Sending...`);
            const sent = await sendViaWhatsApp(conversation_id, suggestedReply);
            if (sent) {
                replyStatus = 'sent';
                sentBy = 'ai';
                sentAt = new Date().toISOString();
            }
        } else if (decision.escalation_reason) {
            console.log(`[AI Worker] Escalation: ${decision.escalation_reason}`);
        }

        const { error: errDecision } = await supabase.from('ai_reply_decisions').insert({
            conversation_id: conversation_id,
            suggested_reply: suggestedReply,
            can_auto_reply: decision.can_auto_reply,
            needs_human_review: decision.needs_human_review,
            escalation_reason: decision.escalation_reason || null,
            confidence_score: decision.confidence_score,
            conversation_stage: decision.conversation_stage,
            reply_status: replyStatus,
            sent_by: sentBy,
            sent_at: sentAt,
            operator_prompt: operator_prompt || null
        });
        if (errDecision) console.error("[AI Worker] DB Error reply_decisions:", errDecision.message);

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
