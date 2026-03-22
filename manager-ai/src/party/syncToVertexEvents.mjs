/**
 * Syncs a completed party draft to the Vertex Supabase client_events table.
 * This is what populates the "Ofertă & Rezervări" panel in the dashboard.
 */
import { createClient } from '@supabase/supabase-js';

const VERTEX_URL = process.env.VERTEX_SUPABASE_URL;
const VERTEX_KEY = process.env.VERTEX_SUPABASE_SERVICE_ROLE_KEY;

const SERVICE_LABELS = {
    animatie: 'Animație', animator: 'Animație', ursitoare: 'Ursitoare',
    vata_de_zahar: 'Vată de Zahăr', popcorn: 'Popcorn',
    arcada_fara_suport: 'Arcadă Baloane', arcada_pe_suport: 'Arcadă pe Suport',
    default: 'Serviciu'
};

export async function syncPartyToVertexEvents(partyDraft, clientPhone) {
    if (!VERTEX_URL || !VERTEX_KEY) {
        console.warn('[VertexSync] Missing Vertex Supabase credentials. Skipping sync.');
        return;
    }
    if (!clientPhone || !partyDraft?.serviciu_principal) return;

    const vtx = createClient(VERTEX_URL, VERTEX_KEY);
    const svc = partyDraft.serviciu_principal;
    const roleTitle = SERVICE_LABELS[svc] || SERVICE_LABELS.default;

    // Extract event details from draft
    const dg = partyDraft.date_generale || {};
    const detalii = partyDraft.detalii_servicii?.[svc] || {};
    const comercial = partyDraft.comercial || {};

    // Use EXACT Romanian key names expected by the Vertex dashboard display
    const loc = dg.localitate || dg.locatie_eveniment || dg.adresa_completa || null;
    const judet = dg.judet ? `, ${dg.judet}` : '';
    const eventDetails = {
        'Data Evenimentului': dg.data_evenimentului || null,
        'Ora de Început': dg.ora_evenimentului || detalii.ora_evenimentului || null,
        'Locația': loc ? `${loc}${judet}` : null,
        'Durata (ore)': detalii.durata_ore || null,
        'Personajul Dorit': detalii.personaj_dorit || detalii.personaj || null,
        'Număr Copii': dg.numar_copii || detalii.numar_copii || null,
        'Vârstă Sărbătorit': dg.varsta_copil || detalii.varsta || null,
        'Tip Locație': dg.interior_sau_exterior || null,
    };
    // Remove null values to keep event_details clean
    Object.keys(eventDetails).forEach(k => { if (eventDetails[k] === null) delete eventDetails[k]; });

    try {
        // Upsert: one entry per (client_phone, role_title) combination
        const { data: existing } = await vtx.from('client_events')
            .select('id, event_details')
            .eq('client_phone', clientPhone)
            .eq('role_title', roleTitle)
            .eq('status', 'active')
            .maybeSingle();

        if (existing) {
            // Merge: only update non-null values
            const merged = { ...existing.event_details };
            for (const [k, v] of Object.entries(eventDetails)) {
                if (v !== null && v !== undefined) merged[k] = v;
            }
            await vtx.from('client_events').update({ event_details: merged }).eq('id', existing.id);
            console.log(`[VertexSync] Updated client_event for ${clientPhone} - ${roleTitle}`);
        } else {
            await vtx.from('client_events').insert({
                client_phone: clientPhone,
                role_title: roleTitle,
                event_details: eventDetails,
                total_amount: 0,
                notes: '',
                status: 'active'
            });
            console.log(`[VertexSync] Created client_event for ${clientPhone} - ${roleTitle}`);
        }
    } catch (e) {
        console.error(`[VertexSync] Failed: ${e.message}`);
    }
}
