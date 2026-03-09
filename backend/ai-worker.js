require("dotenv").config();
const express = require('express');
const { createClient } = require("@supabase/supabase-js");
const { GoogleGenAI, Type } = require('@google/genai');

const SUPABASE_URL = process.env.SUPABASE_URL || "https://mock.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "mock_key";
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

console.log("[AI Worker] Booting GenAI Operational Coordinator Worker...");

const latestExtractions = [];
const latestActions = [];

function keepDebugLog(arr, item) {
    arr.unshift(item);
    if (arr.length > 50) arr.pop();
}

/**
 * GEMINI 2.5 FLASH STRUCTURED EXTRACTION ENGINE
 */
const EventExtractionSchema = {
    type: Type.OBJECT,
    properties: {
        event_type: {
            type: Type.STRING,
            description: "The type of event (e.g. 'private_party', 'school', 'corporate', 'birthday'). Default to 'other' if unknown."
        },
        date: { type: Type.STRING, nullable: true, description: "Mentioned date, e.g. '15 May' or 'tomorrow'" },
        time: { type: Type.STRING, nullable: true },
        location: { type: Type.STRING, nullable: true },
        city: { type: Type.STRING, nullable: true },
        budget: { type: Type.STRING, nullable: true },
        kids_count: { type: Type.INTEGER, nullable: true },
        theme: { type: Type.STRING, nullable: true, description: "Party theme like Spiderman, Frozen, etc." },
        special_requests: { type: Type.STRING, nullable: true, description: "Any specific notes or quirks requested." },
        missing_critical_info: { 
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: "List of missing vital details necessary to finalize a booking (e.g., date, city, event_type). Keep empty if all present."
        },
        suggested_reply: {
            type: Type.STRING,
            description: "A natural, helpful reply in Romanian asking for the missing info or acknowledging the details."
        },
        operational_tasks: {
            type: Type.ARRAY,
            items: {
                type: Type.OBJECT,
                properties: {
                    title: { type: Type.STRING },
                    description: { type: Type.STRING },
                },
                required: ["title", "description"]
            },
            description: "Back-office tasks extrapolated from the conversation, e.g., 'Verifica calendarul pentru data X'."
        }
    },
    required: ["event_type", "missing_critical_info", "suggested_reply", "operational_tasks"]
};

async function extractEntitiesWithGemini(conversationHistory) {
    try {
        const historyText = conversationHistory.map(m => `[${m.sender_type.toUpperCase()}]: ${m.content}`).join('\n');
        const prompt = `
You are the Superparty Events AI Assistant. Analyze the following WhatsApp conversation between a CLIENT and our AGENT.
Extract all concrete event details into JSON. 
If critical details (like date, city, or event_type) are missing, flag them in missing_critical_info, and generate a polite Romanian 'suggested_reply' to ask for them.
Extrapolate any back-office CRM 'operational_tasks' required.

Conversation History:
${historyText}
`;

        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: prompt,
            config: {
                responseMimeType: "application/json",
                responseSchema: EventExtractionSchema,
                temperature: 0.1
            }
        });
        
        return JSON.parse(response.text());
    } catch(err) {
        console.error(`[Gemini Extraction Error] ${err.message}`);
        return null;
    }
}

// 1. Process Message Streams
supabase.channel('messages-coordinator')
  .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, async (payload) => {
      const msg = payload.new;
      if (msg.sender_type !== 'client' || msg.direction !== 'inbound') return;

      console.log(`[AI Worker] Extracting intent from Message ${msg.id}`);
      try {
          const { data: conv } = await supabase.from('conversations').select('client_id').eq('id', msg.conversation_id).single();
          if (!conv) return;

          const { data: recentMsgs } = await supabase.from('messages')
              .select('sender_type, content')
              .eq('conversation_id', msg.conversation_id)
              .order('created_at', { ascending: false })
              .limit(5);

          const context = recentMsgs.reverse();
          const aiResult = await extractEntitiesWithGemini(context);
          if (!aiResult) return;

          const confidence = 0.9; 
          const extPayload = { source_type: 'message', source_id: msg.id, confidence_score: confidence, raw_json: aiResult };
          await supabase.from('ai_extractions').insert(extPayload);
          keepDebugLog(latestExtractions, extPayload);

          const { data: existingEvent } = await supabase.from('events')
              .select('id').eq('client_id', conv.client_id).in('status', ['draft', 'pending_confirmation']).single();

          let eventId = existingEvent?.id;
          if (!eventId) {
              const { data: newEv } = await supabase.from('events').insert({
                  client_id: conv.client_id, 
                  conversation_id: msg.conversation_id,
                  title: `Draft AI: ${aiResult.event_type}`,
                  event_type: aiResult.event_type,
                  status: 'draft',
                  theme: aiResult.theme || null,
                  date_string: aiResult.date || null,
                  location: aiResult.location || null,
                  city: aiResult.city || null,
                  people_count: aiResult.kids_count || null,
                  special_requests: aiResult.special_requests || null
              }).select().single();
              if(newEv) eventId = newEv.id;
          } else {
              await supabase.from('events').update({ 
                  event_type: aiResult.event_type || undefined,
                  theme: aiResult.theme || undefined, 
                  date_string: aiResult.date || undefined,
                  location: aiResult.location || undefined,
                  city: aiResult.city || undefined,
                  people_count: aiResult.kids_count || undefined,
                  special_requests: aiResult.special_requests || undefined
              }).eq('id', eventId);
          }

          if (aiResult.operational_tasks && aiResult.operational_tasks.length > 0) {
              for (const t of aiResult.operational_tasks) {
                 await supabase.from('tasks').insert({
                     client_id: conv.client_id,
                     event_id: eventId || null,
                     title: t.title,
                     description: t.description,
                     status: 'todo'
                 });
              }
          }

          if (aiResult.missing_critical_info && aiResult.missing_critical_info.length > 0) {
              const act1 = { 
                  action_type: 'flag_missing_info', 
                  status: 'pending', 
                  conversation_id: msg.conversation_id, 
                  payload: { missing: aiResult.missing_critical_info } 
              };
              await supabase.from('ai_actions').insert(act1);
              keepDebugLog(latestActions, act1);
          }

          if (aiResult.suggested_reply) {
              const act2 = { 
                  action_type: 'suggest_reply', 
                  status: 'pending', 
                  conversation_id: msg.conversation_id, 
                  payload: { suggested_text: aiResult.suggested_reply } 
              };
              await supabase.from('ai_actions').insert(act2);
              keepDebugLog(latestActions, act2);
          }

      } catch (err) {
          console.error(`[AI Worker Error] ${err.message}`);
      }
  }).subscribe();

supabase.channel('calls-coordinator')
  .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'call_events' }, async (payload) => {
      const call = payload.new;
      if (call.status === 'missed') {
          console.log(`[AI Worker] Analyzing Missed Call ${call.id}`);
          const act = { action_type: 'suggest_reply', status: 'pending', payload: { suggested_text: `Buna ziua! Ati sunat la Superparty dar linia era ocupata. Aveti nevoie de detalii pentru organizarea unui eveniment?` } };
          await supabase.from('ai_actions').insert(act);
          keepDebugLog(latestActions, act);
      }
  }).subscribe();

const adminApp = express();

adminApp.get('/debug/extractions', (req, res) => {
    res.json({ count: latestExtractions.length, data: latestExtractions });
});

adminApp.get('/debug/actions', (req, res) => {
    res.json({ count: latestActions.length, data: latestActions });
});

adminApp.get('/', (req, res) => res.send("GenAI Event Coordinator Running on port 4000"));

const PORT = 4000;
adminApp.listen(PORT, () => {
    console.log(`[AI Worker] Admin/Debug API listening on http://localhost:${PORT}`);
});
