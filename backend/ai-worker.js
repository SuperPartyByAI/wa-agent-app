require("dotenv").config();
const express = require('express');
const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = process.env.SUPABASE_URL || "https://mock.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "mock_key";
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

console.log("[AI Worker] Booting Operational Coordinator Worker...");

// In-Memory Debug Logs
const latestExtractions = [];
const latestActions = [];

function keepDebugLog(arr, item) {
    arr.unshift(item);
    if (arr.length > 50) arr.pop();
}

/**
 * MOCK LLM ENGINE
 * In a production model, this calls OpenAI gpt-4o-mini structured outputs.
 */
function extractEntities(text) {
    const t = text.toLowerCase();
    const data = {
        date: null, time: null, location: null, city: null,
        kids_count: null, budget: null, theme: null,
        special_requests: null, event_type: null
    };

    if (t.includes("botez")) data.event_type = "Botez";
    else if (t.includes("zi de nastere") || t.includes("aniversare")) data.event_type = "Birthday Party";
    else if (t.includes("petrecere")) data.event_type = "Petrecere";

    if (t.includes("bucuresti")) data.city = "Bucuresti";
    if (t.includes("cluj")) data.city = "Cluj";

    if (t.includes("sambata")) data.date = "Sambata urmatoare";
    if (t.includes("duminica")) data.date = "Duminica urmatoare";
    if (t.includes("maine")) data.date = "Maine";

    const kidsMatch = t.match(/(\d+) copii/);
    if (kidsMatch) data.kids_count = parseInt(kidsMatch[1], 10);
    
    if (t.includes("spiderman") || t.includes("spider-man")) data.theme = "Spiderman";
    if (t.includes("elsa") || t.includes("frozen")) data.theme = "Frozen";

    const filledCount = Object.values(data).filter(v => v !== null).length;
    const confidence = filledCount > 0 ? Math.min(0.2 + (filledCount * 0.15), 0.95) : 0;

    return { params: data, confidence };
}

// 1. Process Message Streams
supabase.channel('messages-coordinator')
  .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, async (payload) => {
      const msg = payload.new;
      if (msg.sender_type !== 'client' || msg.direction !== 'inbound') return;

      console.log(`[AI Worker] Extracting intent from Message ${msg.id}`);
      try {
          // A. Map Conversation to Client ID
          const { data: conv } = await supabase.from('conversations').select('client_id').eq('id', msg.conversation_id).single();
          if (!conv) return;

          // B. AI Parsing
          const { params, confidence } = extractEntities(msg.content);
          
          if (confidence > 0) {
              const extPayload = { source_type: 'message', source_id: msg.id, confidence_score: confidence, raw_json: params };
              await supabase.from('ai_extractions').insert(extPayload);
              keepDebugLog(latestExtractions, extPayload);

              // C. Draft Event Logic
              const { data: existingEvent } = await supabase.from('events')
                  .select('id').eq('client_id', conv.client_id).in('status', ['draft', 'pending_confirmation']).single();

              let eventId = existingEvent?.id;
              if (!eventId) {
                  const { data: newEv } = await supabase.from('events').insert({
                      client_id: conv.client_id, conversation_id: msg.conversation_id,
                      title: `Draft AI: ${params.event_type || 'Eveniment Necunoscut'}`,
                      event_type: params.event_type || 'other',
                      status: 'draft',
                      theme: params.theme,
                      special_requests: `Sursa: "${msg.content.substring(0, 100)}..."`
                  }).select().single();
                  eventId = newEv.id;
              } else {
                  // Update Draft loosely
                  await supabase.from('events').update({ 
                      theme: params.theme || undefined, 
                      event_type: params.event_type || undefined 
                  }).eq('id', eventId);
              }

              // D. Missing Info Check & Operational Flags
              const missingFields = [];
              if (!params.date) missingFields.push('data eveniment');
              if (!params.city) missingFields.push('oras');
              if (!params.event_type) missingFields.push('tip petrecere');

              if (missingFields.length > 0) {
                  const act1 = { action_type: 'flag_missing_info', status: 'pending', conversation_id: msg.conversation_id, payload: { missing: missingFields, suggestion: `Recomandam sa il intrebati pe client despre: ${missingFields.join(', ')}.` } };
                  await supabase.from('ai_actions').insert(act1);
                  keepDebugLog(latestActions, act1);
              }

              // E. Summary and Suggest Reply
              const act2 = { action_type: 'suggest_reply', status: 'pending', conversation_id: msg.conversation_id, payload: { suggested_text: `Multumim pentru mesaj! Am notat detaliile. Pentru a finaliza ${params.event_type ? params.event_type : 'rezervarea'}, unde va avea loc petrecerea?` } };
              await supabase.from('ai_actions').insert(act2);
              keepDebugLog(latestActions, act2);
          }

      } catch (err) {
          console.error(`[AI Worker Error] ${err.message}`);
      }
  }).subscribe();

// 2. Process Call Events
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

// --- ADMIN / DEBUG EXPRESS SERVER ---
const adminApp = express();

adminApp.get('/debug/extractions', (req, res) => {
    res.json({ count: latestExtractions.length, data: latestExtractions });
});

adminApp.get('/debug/actions', (req, res) => {
    res.json({ count: latestActions.length, data: latestActions });
});

adminApp.get('/', (req, res) => res.send("AI Event Coordinator Running on port 4000"));

const PORT = 4000;
adminApp.listen(PORT, () => {
    console.log(`[AI Worker] Admin/Debug API listening on http://localhost:${PORT}`);
});
