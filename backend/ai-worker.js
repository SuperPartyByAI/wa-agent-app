require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = process.env.SUPABASE_URL || "https://jrfhprnuxxfwkwjwdsez.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "INSERT_YOUR_SECRET_ROLE_KEY_HERE";
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

console.log("[AI Worker] Starting AI Extraction Engine...");

// Subscribe to new Messages
supabase
  .channel('messages-insert-channel')
  .on(
    'postgres_changes',
    { event: 'INSERT', schema: 'public', table: 'messages' },
    async (payload) => {
      const msg = payload.new;
      
      // Only process Client inbound messages
      if (msg.sender_type !== 'client' || msg.direction !== 'inbound') return;
      
      console.log(`[AI Worker] Analyzing message ${msg.id}...`);
      
      try {
        // Placeholder for Actual OpenAI/Gemini Call (Extacting Intent)
        
        // Mock extraction logic based on the schema structure
        let extractedDate = null;
        if (msg.content.toLowerCase().includes('maine')) {
            const tmr = new Date();
            tmr.setDate(tmr.getDate() + 1);
            extractedDate = tmr.toISOString().split('T')[0];
        }
        
        // 1. Save to `ai_extractions`
        await supabase.from('ai_extractions').insert({
            source_type: 'message',
            source_id: msg.id,
            extracted_date: extractedDate,
            confidence_score: 0.85,
            raw_json: { text_analyzed: msg.content }
        });
        
        // 2. Instantiate response structure in `ai_actions`
        await supabase.from('ai_actions').insert({
            conversation_id: msg.conversation_id,
            action_type: 'suggest_reply',
            status: 'pending',
            payload: {
                suggested_text: "Am inregistrat cererea dumneavoastra. Va contactam in scurt timp!"
            }
        });
        
        console.log(`[AI Worker] Extraction & Action spawned for message ${msg.id}`);
        
      } catch (err) {
        console.error(`[AI Worker Error] ${err.message}`);
      }
    }
  )
  .subscribe((status) => {
    console.log(`[AI Worker] Supabase Messages Realtime Status: ${status}`);
  });

// Subscribe to new Call Events
supabase
  .channel('calls-insert-channel')
  .on(
    'postgres_changes',
    { event: 'INSERT', schema: 'public', table: 'call_events' },
    async (payload) => {
       const call = payload.new;
       if (call.status === 'missed') {
           console.log(`[AI Worker] Processing Missed Call from ${call.from_number}...`);
           
           try {
               await supabase.from('ai_actions').insert({
                   action_type: 'suggest_reply',
                   status: 'pending',
                   payload: {
                       suggested_text: `Buna ziua! Ati sunat la firma. Agentul nostru inteligent v-a preluat contactul temporar. Cu ce va putem ajuta privind evenimentul?`
                   }
               });
               console.log(`[AI Worker] Auto-Reply action queued for Missed Call ${call.id}`);
           } catch (e) {
               console.error(`[AI Worker] Failed to persist action for missed call: ${e.message}`);
           }
       }
    }
  )
  .subscribe((status) => {
    console.log(`[AI Worker] Supabase Calls Realtime Status: ${status}`);
  });

// Keep process alive
process.stdin.resume();
