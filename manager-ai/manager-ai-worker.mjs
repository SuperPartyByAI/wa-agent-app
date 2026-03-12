import { createClient } from '@supabase/supabase-js';
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

/**
 * Calls the local Ollama server via the OpenAI-compatible /v1/chat/completions endpoint.
 * Returns parsed JSON or null on failure.
 */
async function callLocalLLM(systemPrompt, userMessage) {
    const url = `${LLM_BASE_URL}/v1/chat/completions`;
    
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 120000); // 2min timeout for CPU inference
        
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

const SYSTEM_PROMPT = `Ești asistentul AI al Superparty — companie de organizare evenimente și petreceri pentru copii.
Analizează conversația WhatsApp de mai jos dintre echipa noastră (Superparty) și un Client.
Extrage detaliile principale folosind DOAR informațiile explicite din conversație. Nu inventa nimic.

IMPORTANT: Toate valorile text din JSON TREBUIE să fie în limba ROMÂNĂ.

Returnează un obiect JSON STRICT conform acestui format exact:
{
  "client_memory": {
    "priority_level": "normal|ridicat|urgent",
    "internal_notes_summary": "Rezumat scurt 1-2 propoziții despre cine este clientul și ce dorește."
  },
  "event_draft": {
    "draft_type": "petrecere_standard",
    "structured_data": {
      "location": "locația extrasă sau null",
      "date": "data extrasă sau null",
      "event_type": "tipul extras (ex: botez, nuntă, petrecere copii, aniversare) sau null"
    },
    "missing_fields": ["lista de informații lipsă pe care trebuie să le aflăm de la client"]
  },
  "conversation_state": {
    "current_intent": "Ce dorește clientul în acest moment? (ex: cere preț, confirmă rezervare, se plânge)",
    "next_best_action": "Ce ar trebui să răspundă operatorul nostru în continuare?"
  },
  "suggested_reply": "Textul exact pe care operatorul îl poate trimite clientului. Scrie ca și cum ești operatorul Superparty: profesional, cald, prietenos. Salut cu Bună!, nu cu Bună ziua. Folosește emoji-uri subtile. Max 3-4 propoziții.",
  "decision": {
    "can_auto_reply": false,
    "needs_human_review": true,
    "escalation_reason": null,
    "confidence_score": 0,
    "conversation_stage": "lead"
  }
}

REGULI PENTRU "decision":
- "conversation_stage" poate fi: "lead", "qualifying", "quoting", "booking", "payment", "coordination", "completed", "escalation"
- "confidence_score" între 0-100: cât de sigur ești că suggested_reply este potrivit
- "can_auto_reply" = true DOAR dacă:
  * mesajul este simplu (salut, cerere info generală, confirmare simplă, cerere date eveniment)
  * confidence_score >= 75
  * NU există conflict, reclamație sau negociere de preț
- "needs_human_review" = true dacă:
  * negociere de preț
  * cerere explicită de a vorbi cu un om
  * situație ambiguă
  * confidence_score < 60
- "escalation_reason" se completează când:
  * clientul este nemulțumit sau iritat
  * apare conflict sau reclamație
  * aspect juridic sau financiar sensibil
  * contradicții în datele evenimentului
  * clientul devine confuz sau agresiv`;

/**
 * Send a message to WhatsApp via the whts-up transport API.
 */
async function sendViaWhatsApp(conversationId, text) {
    // Get session_id for this conversation
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

        console.log(`[AI AutoSend] ✅ Message sent successfully for conversation ${conversationId}`);
        return true;
    } catch (err) {
        console.error('[AI AutoSend] Network error:', err.message);
        return false;
    }
}

export async function processConversation(conversation_id, message_id = null, operator_prompt = null) {
    if (!conversation_id) return;
    
    console.log(`[AI Worker] Starting text-understanding pipeline for ${conversation_id}...`);

    try {
        // 1. Fetch conversation history (last 50 messages for context window)
        const { data: messages, error: msgErr } = await supabase
            .from('messages')
            .select('content, direction, created_at, sender_type')
            .eq('conversation_id', conversation_id)
            .order('created_at', { ascending: false })
            .limit(50);

        if (msgErr) throw new Error(`Failed to fetch messages: ${msgErr.message}`);
        if (!messages || messages.length === 0) return;

        // Reverse to chronological order for LLM
        const transcript = messages.reverse().map(m => 
            `[${new Date(m.created_at).toISOString()}] ${m.sender_type === 'agent' ? 'Superparty (Noi)' : 'Client'}: ${m.content}`
        ).join('\n');

        // Build user message with optional operator prompt
        let userMessage = `--- CONVERSAȚIE ---\n${transcript}`;
        if (operator_prompt) {
            userMessage += `\n\n--- INSTRUCȚIUNE OPERATOR ---\n${operator_prompt}\nAplicăm instrucțiunea de mai sus la generarea răspunsului sugerat.`;
        }

        // 2. Call local LLM for structured extraction
        console.log(`[AI Worker] Calling local LLM (${LLM_MODEL}) with transcript (${transcript.length} chars)${operator_prompt ? ' + operator prompt' : ''}...`);
        
        let analysis = await callLocalLLM(SYSTEM_PROMPT, userMessage);
        
        if (!analysis) {
            console.warn(`[AI Worker] Local LLM unreachable or failed. Using mock fallback for pipeline continuity.`);
            analysis = {
                client_memory: { priority_level: "ridicat", internal_notes_summary: "MOCK: Client interesat de organizarea unui eveniment." },
                event_draft: { draft_type: "petrecere_standard", structured_data: { location: "București", date: null, event_type: null }, missing_fields: ["număr invitați", "buget", "data evenimentului"] },
                conversation_state: { current_intent: "MOCK: solicită informații", next_best_action: "Trimite pachetele și prețurile disponibile." },
                suggested_reply: "Bună! 😊 Mulțumim pentru interesul acordat! Vă putem oferi mai multe detalii despre pachetele noastre. Ce tip de eveniment planificați?",
                decision: { can_auto_reply: false, needs_human_review: true, escalation_reason: null, confidence_score: 0, conversation_stage: "lead" }
            };
        }

        // Ensure decision object exists with defaults
        const decision = analysis.decision || { can_auto_reply: false, needs_human_review: true, escalation_reason: null, confidence_score: 0, conversation_stage: 'lead' };
        const suggestedReply = analysis.suggested_reply || analysis.conversation_state?.next_best_action || 'Nu am putut genera un răspuns.';

        console.log(`[AI Worker] Analysis complete (source: ${analysis.client_memory?.internal_notes_summary?.startsWith('MOCK') ? 'MOCK' : 'LOCAL_LLM'}). Decision: auto=${decision.can_auto_reply}, review=${decision.needs_human_review}, confidence=${decision.confidence_score}, stage=${decision.conversation_stage}`);

        // 3. Upsert State into AI Core Tables
        const { data: conv } = await supabase.from('conversations').select('client_id').eq('id', conversation_id).single();
        const clientId = conv?.client_id;

        if (clientId) {
            const { error: err1 } = await supabase.from('ai_client_memory').upsert({
                client_id: clientId,
                priority_level: analysis.client_memory.priority_level,
                internal_notes_summary: analysis.client_memory.internal_notes_summary,
                updated_at: new Date().toISOString()
            });
            if (err1) console.error("[AI Worker] DB Error memory:", err1.message);
        }

        const { data: existingDraft } = await supabase.from('ai_event_drafts').select('id').eq('conversation_id', conversation_id).maybeSingle();
        
        let err2 = null;
        if (existingDraft) {
             const { error } = await supabase.from('ai_event_drafts').update({
                client_id: clientId,
                draft_type: analysis.event_draft.draft_type,
                structured_data_json: analysis.event_draft.structured_data,
                missing_fields_json: analysis.event_draft.missing_fields,
                updated_at: new Date().toISOString()
            }).eq('id', existingDraft.id);
            err2 = error;
        } else {
             const { error } = await supabase.from('ai_event_drafts').insert({
                conversation_id: conversation_id,
                client_id: clientId,
                draft_type: analysis.event_draft.draft_type,
                structured_data_json: analysis.event_draft.structured_data,
                missing_fields_json: analysis.event_draft.missing_fields,
                updated_at: new Date().toISOString()
            });
            err2 = error;
        }
        if (err2) console.error("[AI Worker] DB Error drafts:", err2.message);

        const statePayload = {
            conversation_id: conversation_id,
            current_intent: analysis.conversation_state.current_intent,
            next_best_action: analysis.conversation_state.next_best_action,
            updated_at: new Date().toISOString()
        };
        
        if (message_id) {
            statePayload.last_processed_message_id = message_id;
        }

        const { error: err3 } = await supabase.from('ai_conversation_state').upsert(statePayload);
        if (err3) console.error("[AI Worker] DB Error state:", err3.message);

        // 4. Save AI reply decision (audit trail)
        let replyStatus = 'pending';
        let sentBy = 'pending';
        let sentAt = null;

        // Auto-send logic with safety switch
        if (AI_AUTOREPLY_ENABLED && decision.can_auto_reply && !decision.needs_human_review && decision.confidence_score >= 75) {
            console.log(`[AI Worker] 🤖 Auto-reply conditions met (confidence=${decision.confidence_score}, stage=${decision.conversation_stage}). Sending...`);
            const sent = await sendViaWhatsApp(conversation_id, suggestedReply);
            if (sent) {
                replyStatus = 'sent';
                sentBy = 'ai';
                sentAt = new Date().toISOString();
            } else {
                console.warn('[AI Worker] Auto-send failed, marking as pending for operator.');
            }
        } else if (decision.escalation_reason) {
            console.log(`[AI Worker] ⚠️ Escalation: ${decision.escalation_reason}`);
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

        // 5. Generate the dynamic layout JSON for Android Renderer
        const escalationBadge = decision.escalation_reason ? `⚠️ Escaladare: ${decision.escalation_reason}` : null;
        
        const dynamicSchema = [
            // Status badge — confidence, stage, escalation
            {
                type: "status_badge",
                items: [
                    { label: "Încredere AI", value: `${decision.confidence_score}%` },
                    { label: "Etapă", value: decision.conversation_stage },
                    ...(escalationBadge ? [{ label: "⚠️ Escaladare", value: decision.escalation_reason }] : [])
                ]
            },
            // Rezumat card
            {
                type: "card",
                title: "🧠 Creier AI - Rezumat",
                items: [
                    { label: "Prioritate", value: analysis.client_memory.priority_level },
                    { label: "Intent", value: analysis.conversation_state.current_intent }
                ]
            },
            // Draft Eveniment card
            {
                type: "card",
                title: "📝 Draft Eveniment",
                items: [
                    { label: "Tip", value: analysis.event_draft.structured_data.event_type || "Nespecificat" },
                    { label: "Locație", value: analysis.event_draft.structured_data.location || "Nespecificat" },
                    { label: "Dată", value: analysis.event_draft.structured_data.date || "Nespecificat" }
                ]
            },
            // Suggested Reply card — the key new component
            {
                type: "reply_card",
                title: replyStatus === 'sent' ? "✅ Răspuns Trimis de AI" : "💬 Răspuns Propus",
                text: suggestedReply,
                items: [
                    { label: "Status", value: replyStatus === 'sent' ? "Trimis automat" : "Așteaptă confirmare" }
                ],
                action: "inject_reply",
                action_payload: suggestedReply
            },
            // Prompt input — operator can give instructions
            {
                type: "prompt_input",
                title: "🎯 Instrucțiune Operator",
                text: "Scrie o instrucțiune pentru AI (ex: „răspunde mai cald", „întreabă de numărul de copii")",
                action: "send_prompt"
            },
            // Missing fields
            {
                type: "form_card",
                title: "Trebuie să aflăm:",
                items: (analysis.event_draft.missing_fields || []).map(f => ({ label: f, value: "" }))
            }
        ];

        const { error: err4 } = await supabase.from('ai_ui_schemas').insert({
            conversation_id: conversation_id,
            screen_type: 'brain_tab',
            layout_json: dynamicSchema
        });
        if (err4) console.error("[AI Worker] DB Error schemas:", err4.message);

        console.log(`[AI Worker] ✅ Successfully processed conversation ${conversation_id}. Reply: ${replyStatus}, Confidence: ${decision.confidence_score}%`);

    } catch (error) {
        console.error(`[AI Worker] Critical failure during processing:`, error);
    }
}
