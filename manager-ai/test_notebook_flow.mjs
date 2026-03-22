import { config } from 'dotenv';
config();
import { processConversation } from './src/orchestration/processConversation.mjs';

// Mock minimal dependencies
global.supabase = {
  from: () => ({
    select: () => ({ eq: () => ({ single: () => ({ data: { key: 'template_animator', json_schema: { proprietati_cerute: [{ nume: 'data', descriere: 'Data eveniment (Azi/Maine)' }] } } }) }) }),
    upsert: () => ({})
  })
};

async function run() {
  console.log("Simulating incoming message...");
  // We mock the context pack lightly. The core issue is the LLM output parsing.
  try {
     const mockContext = { client_context: { client: { real_phone_e164: "+40700000000" } } };
     const res = await processConversation("555-uuid", "+40700000000", "Aș dori un animator mâine la ora 16:00.", [], mockContext);
  } catch(e) { console.error(e); }
  
  console.log("Finished test injection");
}
run();
