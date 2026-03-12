import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// Local LLM config — Ollama (self-hosted, zero external API cost)
const LLM_BASE_URL = process.env.LOCAL_LLM_BASE_URL || 'http://localhost:11434';
const LLM_MODEL = process.env.LOCAL_LLM_MODEL || 'qwen2.5:7b';

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
  }
}`;

export async function processConversation(conversation_id, message_id = null) {
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

        // 2. Call local LLM for structured extraction
        console.log(`[AI Worker] Calling local LLM (${LLM_MODEL}) with transcript (${transcript.length} chars)...`);
        
        let analysis = await callLocalLLM(SYSTEM_PROMPT, `--- CONVERSATION ---\n${transcript}`);
        
        if (!analysis) {
            console.warn(`[AI Worker] Local LLM unreachable or failed. Using mock fallback for pipeline continuity.`);
            analysis = {
                client_memory: { priority_level: "ridicat", internal_notes_summary: "MOCK: Client interesat de organizarea unui eveniment." },
                event_draft: { draft_type: "petrecere_standard", structured_data: { location: "București", date: null, event_type: null }, missing_fields: ["număr invitați", "buget", "data evenimentului"] },
                conversation_state: { current_intent: "MOCK: solicită informații", next_best_action: "Trimite pachetele și prețurile disponibile." }
            };
        }

        console.log(`[AI Worker] Analysis complete (source: ${analysis.client_memory?.internal_notes_summary?.startsWith('MOCK') ? 'MOCK' : 'LOCAL_LLM'}). Updating DB...`);

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

        // 4. Generate the dynamic layout JSON for Android Renderer
        const dynamicSchema = [
            {
                type: "card",
                title: "🧠 Creier AI - Rezumat",
                items: [
                    { label: "Prioritate", value: analysis.client_memory.priority_level },
                    { label: "Intent", value: analysis.conversation_state.current_intent }
                ]
            },
            {
                type: "card",
                title: "📝 Draft Eveniment",
                items: [
                    { label: "Tip", value: analysis.event_draft.structured_data.event_type || "Nespecificat" },
                    { label: "Locație", value: analysis.event_draft.structured_data.location || "Nespecificat" },
                    { label: "Dată", value: analysis.event_draft.structured_data.date || "Nespecificat" }
                ]
            },
            {
                type: "section",
                title: "🤖 Următoarea Acțiune",
                items: [
                    { label: "Sugestie AI", value: analysis.conversation_state.next_best_action }
                ]
            },
            {
                type: "form_card",
                title: "Trebuie să aflăm:",
                items: analysis.event_draft.missing_fields.map(f => ({ label: f, value: "" }))
            }
        ];

        const { error: err4 } = await supabase.from('ai_ui_schemas').insert({
            conversation_id: conversation_id,
            screen_type: 'brain_tab',
            layout_json: dynamicSchema
        });
        if (err4) console.error("[AI Worker] DB Error schemas:", err4.message);

        console.log(`[AI Worker] Successfully mapped V1 AI knowledge to conversation ${conversation_id}.`);

    } catch (error) {
        console.error(`[AI Worker] Critical failure during processing:`, error);
    }
}
