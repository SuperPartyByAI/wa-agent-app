import { createClient } from '@supabase/supabase-js';
import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// If developer hasn't put the key yet, gracefully warn and exit
const ai = process.env.GEMINI_API_KEY 
    ? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY }) 
    : null;

export async function processConversation(conversation_id, message_id = null) {
    if (!conversation_id) return;
    
    console.log(`[AI Worker] Starting real text-understanding pipeline for ${conversation_id}...`);
    
    if (!ai) {
        console.warn(`[AI Worker] WARNING: GEMINI_API_KEY missing in .env. Using mock analysis for pipeline validation.`);
    }

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

        // 2. Query Gemini for structured extraction (V1 baseline)
        const systemPrompt = `
You are the Superparty AI Event Manager. 
Analyze the following WhatsApp conversation between our business (Superparty) and a Client.
Extract the core details using ONLY the information explicitly stated. Do not hallucinate.

Return a STRICT JSON object matching this exact schema:
{
  "client_memory": {
    "priority_level": "normal|high|urgent",
    "internal_notes_summary": "A brief 1-2 sentence summary of who the client is and what they generally want."
  },
  "event_draft": {
    "draft_type": "standard_party",
    "structured_data": {
      "location": "extracted location or null",
      "date": "extracted date or null",
      "event_type": "extracted type (e.g., botez, nunta, petrecere copii) or null"
    },
    "missing_fields": ["list of strings representing what we still need to ask to organize the event"]
  },
  "conversation_state": {
    "current_intent": "What is the client trying to do right now? (e.g. asking for price, booking confirmed, complaining)",
    "next_best_action": "What should our human operator reply next?"
  }
}`;

        console.log(`[AI Worker] Asking Gemini to parse transcript (${transcript.length} chars)...`);
        
        let jsonRaw = "";
        let analysis = null;
        if (ai) {
            try {
                const response = await ai.models.generateContent({
                    model: 'gemini-2.5-flash',
                    contents: [
                        { role: 'user', parts: [{ text: `${systemPrompt}\n\n--- CONVERSATION ---\n${transcript}` }] }
                    ],
                    config: {
                        responseMimeType: "application/json",
                    }
                });
                jsonRaw = response.text;
                analysis = JSON.parse(jsonRaw);
            } catch (geminiErr) {
                console.error(`[AI Worker] Gemini generation or JSON parse failed:`, geminiErr.message);
                return; // Abort processing to avoid polluting DB with bad state
            }
        } else {
             // Mock fallback for pipeline validation
             analysis = {
                client_memory: { priority_level: "high", internal_notes_summary: "MOCKED: Client interested in booking an event." },
                event_draft: { draft_type: "standard_party", structured_data: { location: "Bucuresti", date: "2024-12-01", event_type: "Nunta" }, missing_fields: ["numar_invitati", "buget"] },
                conversation_state: { current_intent: "MOCKED: wants_price", next_best_action: "Provide price packages." }
             };
        }

        console.log(`[AI Worker] Gemini analysis complete. Updating database state...`);

        // 3. Upsert State into AI Core Tables
        
        // Fetch client_id for the memory update
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

        const { error: err2 } = await supabase.from('ai_event_drafts').upsert({
            conversation_id: conversation_id,
            client_id: clientId,
            draft_type: analysis.event_draft.draft_type,
            structured_data_json: analysis.event_draft.structured_data,
            missing_fields_json: analysis.event_draft.missing_fields,
            updated_at: new Date().toISOString()
        }, { onConflict: 'conversation_id' }); // Assuming 1 active draft per conversation for now
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
                title: "🤖 Next Best Action",
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
