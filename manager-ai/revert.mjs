import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } from './src/config/env.mjs';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function run() {
    const origConvId = '2f5c02cc-1fd6-46e3-9562-a5285825a892';
    const clonedConvId = 'ee1375eb-d2d9-4578-a643-c4249cddca9f';

    console.log("Reverting Jinu draft to original conversation...");
    await supabase.from('ai_event_drafts').update({ conversation_id: origConvId }).eq('conversation_id', clonedConvId);
    
    console.log("Reverting Jinu CRM action to original conversation...");
    await supabase.from('ai_client_events').update({ conversation_id: origConvId }).eq('conversation_id', clonedConvId);

    console.log("Deleting cloned conversation...");
    const { error } = await supabase.from('conversations').delete().eq('id', clonedConvId);
    console.log("Delete result:", error || "OK");
    
    console.log("SUCCESS REVERT!");
}
run();
