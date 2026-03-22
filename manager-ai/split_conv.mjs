import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } from './src/config/env.mjs';
import crypto from 'crypto';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function run() {
    const { data: drafts } = await supabase.from('ai_event_drafts')
        .select('*')
        .eq('id', 'bafd6866-27d9-4cee-ae40-d765833dd696');
        
    if (!drafts || drafts.length === 0) return;
    const jinuDraft = drafts[0];
    const origConvId = jinuDraft.conversation_id;

    const { data: convs } = await supabase.from('conversations')
        .select('*')
        .eq('id', origConvId);
        
    if (convs && convs.length > 0) {
        const origConv = convs[0];
        const newConvId = crypto.randomUUID();
        
        // Change session_id to avoid unique_active_conv_per_route
        const newConv = { 
            ...origConv, 
            id: newConvId,
            session_id: origConv.session_id ? `${origConv.session_id}_split` : crypto.randomUUID()
        };
        
        console.log("Cloning conversation into", newConvId);
        const { error: insErr } = await supabase.from('conversations').insert(newConv);
            
        if (!insErr) {
            console.log("Updating Jinu draft to point to cloned conversation...");
            await supabase.from('ai_event_drafts').update({ conversation_id: newConvId }).eq('id', jinuDraft.id);
            
            console.log("Updating Jinu CRM action to point to cloned conversation...");
            const { data: events } = await supabase.from('ai_client_events').select('*');
            for (const ev of events || []) {
                if (ev.conversation_id === origConvId && ev.event_details && ev.event_details['Personajul Dorit'] === 'Jinu') {
                    await supabase.from('ai_client_events').update({ conversation_id: newConvId }).eq('id', ev.id);
                    console.log("Updated ai_client_events:", ev.id);
                }
            }
            console.log("SUCCESS!");
        } else {
            console.error("Insert error:", insErr);
        }
    } else {
        console.error("Original conversation not found in conversations table.");
    }
}
run();
