import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

/**
 * Încarcă Profilul Clientului și Portofoliul său de petreceri
 * Caută clientul după telefon (E.164 form).
 * Extrage și pregătește un JSON compact pentru Prompt-ul Agentului.
 */
export async function loadClientContext(phoneE164, conversationId) {
    let clientProfile = null;
    let clientEvents = [];
    let memorySummary = null;

    // 1. Căutăm Clientul (ai_client_profiles)
    const { data: profiles, error: profileErr } = await supabase
        .from('ai_client_profiles')
        .select('*')
        .eq('telefon_e164', phoneE164)
        .limit(1);

    if (profileErr) {
        console.error(`[MemoryLoader] Error fetching client profile:`, profileErr.message);
        return { error: 'profile_fetch_error' };
    }

    if (!profiles || profiles.length === 0) {
        // Client Complet Nou pe axa de Baze de Date. 
        // Va fi instanțiat cu primul lui eveniment direct din processConversation.
        return {
            is_new_client: true,
            phone_e164: phoneE164,
            active_events_count: 0,
            events: []
        };
    }

    clientProfile = profiles[0];

    // 2. Căutăm Evenimentele (ai_client_events)
    // Aducem doar petrecerile nefinalizate / active.
    const { data: events, error: eventsErr } = await supabase
        .from('ai_client_events')
        .select('*')
        .eq('client_id', clientProfile.client_id)
        .eq('is_active', true)
        .order('created_at', { ascending: false });

    if (!eventsErr && events) {
        clientEvents = events;
    }

    // 3. Căutăm Client Memory Summary
    const { data: summaryData } = await supabase
        .from('ai_client_memory_summary')
        .select('*')
        .eq('client_id', clientProfile.client_id)
        .limit(1);

    if (summaryData && summaryData.length > 0) {
        memorySummary = summaryData[0];
    }

    // Compunem contextul
    const activeCount = clientEvents.length;
    
    const context = {
        is_new_client: false,
        client: {
            id: clientProfile.client_id,
            name: clientProfile.nume_client,
            type: clientProfile.tip_client,
            phone: clientProfile.telefon_e164,
            billing_preset: clientProfile.date_facturare_uzuale,
            preferences: clientProfile.preferinte_recurente
        },
        memory: memorySummary ? memorySummary.summary_text : `Clientul are ${activeCount} evenimente active.`,
        active_events_count: activeCount,
        events: clientEvents.map(ev => ({
            event_id: ev.event_id,
            status: ev.status_eveniment,
            commercial_status: ev.status_comercial,
            date: ev.data_evenimentului,
            time: ev.ora_evenimentului,
            location: ev.localitate,
            service_summary: ev.suma_totala_servicii,
            celebrant: ev.nume_sarbatorit
        }))
    };

    return context;
}

/**
 * Creează rapid un Profil Nou de Client și un Eveniment inițial pe baza unui telefon.
 * Se folosește la un First Contact.
 */
export async function createNewClientWithEvent(phoneE164, conversationId) {
    // Insert profil
    const { data: profData, error: profErr } = await supabase
        .from('ai_client_profiles')
        .insert({
            telefon_e164: phoneE164,
            tip_client: 'persoana_fizica'
        })
        .select('client_id')
        .single();
        
    if (profErr || !profData) {
        console.error(`[MemoryLoader] Create Client Profil Fail:`, profErr?.message);
        throw new Error("Cannot create client profile");
    }

    const clientId = profData.client_id;

    // Insert Event
    const { data: eventData, error: eventErr } = await supabase
        .from('ai_client_events')
        .insert({
            client_id: clientId,
            source_conversation_id: conversationId,
            status_eveniment: 'draft',
            status_comercial: 'lead_nou',
            is_active: true
        })
        .select('event_id')
        .single();

    if (eventErr || !eventData) {
        console.error(`[MemoryLoader] Create Event Fail:`, eventErr?.message);
        throw new Error("Cannot create client event");
    }

    // Generam și Summary-ul
    await supabase.from('ai_client_memory_summary').insert({
        client_id: clientId,
        summary_text: 'Client complet nou. Prima petrecere inițiată.',
        active_events_count: 1,
        active_event_ids: [eventData.event_id],
        last_active_event_id: eventData.event_id
    });

    return {
        client_id: clientId,
        event_id: eventData.event_id
    };
}
