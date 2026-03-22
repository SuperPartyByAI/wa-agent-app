import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const conv_id = '3119205d-dbbf-4787-bdad-3129fe2eeebc';
async function run() {
    await supabase.from('conversations').update({ status: 'open', assigned_to: null, custom_inbox_id: null }).eq('id', conv_id);
    await supabase.from('ai_lead_runtime_states').update({ 
        closed_status: 'open', 
        handoff_to_operator: false,
        lead_state: 'salut_initial',
        do_not_followup: false
    }).eq('conversation_id', conv_id);
    console.log('Force reopen complete');
}
run();
