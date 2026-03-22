import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://jrfhprnuxxfwkwjwdsez.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpyZmhwcm51eHhmd2t3andkc2V6Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MzAwMjIzMiwiZXhwIjoyMDg4NTc4MjMyfQ.0SoUFRVD3PyQg45QKvBM0yDoGJMNrsV-1KyGX0TA4yI';
const supabase = createClient(supabaseUrl, supabaseKey);

async function runSmokeTest() {
    console.log("--- SMOKE TEST MINIMAL ---");
    
    // 1. Inserare client
    const { data: clientData, error: clientErr } = await supabase
        .from('ai_client_profiles')
        .insert([{ telefon_e164: '+40000000000', nume_client: 'TEST CLIENT' }])
        .select('client_id')
        .single();
    if (clientErr) {
        console.error("Client Insert Error:", clientErr);
        return;
    }
    const clientId = clientData.client_id;
    console.log("1) Created Client ID:", clientId);

    // 2. Inserare event legat de client
    const { data: eventData, error: eventErr } = await supabase
        .from('ai_client_events')
        .insert([{ client_id: clientId, source_conversation_id: 'conv-test', status_eveniment: 'draft' }])
        .select('event_id')
        .single();
    if (eventErr) {
        console.error("Event Insert Error:", eventErr);
        return;
    }
    const eventId = eventData.event_id;
    console.log("2) Created Event ID:", eventId);

    // 3. Verificare change_log insert posibil
    const { data: logData, error: logErr } = await supabase
        .from('ai_event_change_log')
        .insert([{ 
            event_id: eventId, 
            client_id: clientId, 
            changed_field: 'localitate', 
            new_value: 'Bucuresti', 
            requested_by: 'client' 
        }])
        .select('id')
        .single();
    if (logErr) {
        console.error("Change Log Insert Error:", logErr);
        return;
    }
    console.log("3) Created Change Log ID:", logData.id);
    
    // Cleanup the smoke test data
    console.log("Cleaning up smoke test data...");
    await supabase.from('ai_client_profiles').delete().eq('client_id', clientId);
    console.log("Cleanup finished.");
}

runSmokeTest();
