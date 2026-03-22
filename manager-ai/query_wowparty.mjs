import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = process.env.VERTEX_SUPABASE_URL ? createClient(process.env.VERTEX_SUPABASE_URL, process.env.VERTEX_SUPABASE_SERVICE_ROLE_KEY) : createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const rawSupa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
    console.log("Querying client_events for CRM...");
    const phone = '+40761641858';
    
    // CRM Events table
    const { data: events } = await supabase.from('client_events').select('*').ilike('client_phone', `%761641858%`);
    console.log("Events found in CRM:", events?.length);
    console.dir(events, { depth: null });

    // Also check ai_event_drafts via the raw supabase (in case it differs)
    const { data: convs } = await rawSupa.from('conversations').select('id, client_id(real_phone_e164)').limit(300);
    const conv = convs.find(c => c.client_id?.real_phone_e164?.includes('761641858'));
    if(conv) {
         console.log("Conversation ID:", conv.id);
         const { data: drafts } = await rawSupa.from('ai_event_drafts').select('*').eq('conversation_id', conv.id);
         console.log("Drafts mapped to conv:", drafts?.length);
    }
}
run();
