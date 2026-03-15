import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL || 'https://jrfhprnuxxfwkwjwdsez.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

/**
 * Loads the active Party Draft (Event Dossier) for a given conversation.
 * If none exists, creates a fresh draft representing a clean slate.
 */
export async function loadPartyDraft(conversationId, clientId = null) {
    if (!conversationId) throw new Error("conversationId is required to load a party draft.");

    try {
        const { data, error } = await supabase
            .from('ai_party_drafts')
            .select('*')
            .eq('conversation_id', conversationId)
            .single();

        if (error && error.code !== 'PGRST116') { // PGRST116 = not found
            console.error(`[loadPartyDraft] DB Error: ${error.message}`);
            return null; // Degrade gracefully
        }

        if (data) {
            return data;
        }

        // Return a clean default structure if not found
        // Note: We do not eagerly INSERT here. We save after the NLP processing builds substance.
        return {
            conversation_id: conversationId,
            client_id: clientId,
            status_dosar: 'draft',
            stare_lead: 'lead_nou',
            serviciu_principal: null,
            servicii_active: [],
            pachet_selectat: null,
            date_generale: {},
            detalii_servicii: {},
            facturare: {},
            comercial: {
                roluri_active: [],
                campuri_obligatorii_lipsa: [],
                gata_pentru_oferta: false,
                scor_lead: 0,
                temperatura_lead: 'cold',
                urmatoarea_actiune: null,
                obiectiv_curent: null
            },
            operational: {
                operator_alocat: null,
                necesita_interventie_umana: false,
                motiv_escaladare: null,
                follow_up_programat_pentru: null,
                preluare_umana_activa: false
            },
            istoric_note: []
        };
    } catch (e) {
        console.error(`[loadPartyDraft] Exception: ${e.message}`);
        return null;
    }
}
