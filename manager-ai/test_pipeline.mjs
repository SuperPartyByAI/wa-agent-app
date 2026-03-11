import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { processConversation } from './manager-ai-worker.mjs';

dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  const { data: conv } = await supabase.from('conversations').select('id, client_id').eq('channel', 'whatsapp').order('updated_at', { ascending: false }).limit(1).single();
  if (conv) {
    console.log("Selected CONV ID:", conv.id);
    
    // Check BEFORE state
    const { data: bState } = await supabase.from('ai_conversation_state').select('*').eq('conversation_id', conv.id).maybeSingle();
    const { data: bMemory } = await supabase.from('ai_client_memory').select('*').eq('client_id', conv.client_id).maybeSingle();
    const { data: bDrafts } = await supabase.from('ai_event_drafts').select('*').eq('conversation_id', conv.id).maybeSingle();
    const { data: bSchemas } = await supabase.from('ai_ui_schemas').select('*').eq('conversation_id', conv.id).order('generated_at', { ascending: false }).limit(1).maybeSingle();
    
    console.log("=== BEFORE STATE ===");
    console.log("State:", bState !== null);
    console.log("Memory:", bMemory !== null);
    console.log("Drafts:", bDrafts !== null);
    console.log("Schemas:", bSchemas !== null);

    console.log("--- RUNNING PIPELINE ---");
    await processConversation(conv.id);

    // Check AFTER state
    const { data: aState } = await supabase.from('ai_conversation_state').select('*').eq('conversation_id', conv.id).maybeSingle();
    const { data: aMemory } = await supabase.from('ai_client_memory').select('*').eq('client_id', conv.client_id).maybeSingle();
    const { data: aDrafts } = await supabase.from('ai_event_drafts').select('*').eq('conversation_id', conv.id).maybeSingle();
    const { data: aSchemas } = await supabase.from('ai_ui_schemas').select('*').eq('conversation_id', conv.id).order('generated_at', { ascending: false }).limit(1).maybeSingle();

    console.log("=== AFTER STATE ===");
    console.log("State:", JSON.stringify(aState, null, 2));
    console.log("Memory:", JSON.stringify(aMemory, null, 2));
    console.log("Drafts:", JSON.stringify(aDrafts, null, 2));
    console.log("Schemas:", JSON.stringify(aSchemas, null, 2));

  } else {
    console.log("No conversations found.");
  }
}
run();
