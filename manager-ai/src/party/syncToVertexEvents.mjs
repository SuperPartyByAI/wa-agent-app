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

    const eventDetails = {
        data_evenimentului: dg.data_evenimentului || null,
        ora_evenimentului: dg.ora_evenimentului || detalii.ora_evenimentului || null,
        localitate: dg.localitate || dg.locatie_eveniment || null,
        judet: dg.judet || null,
        adresa_completa: dg.adresa_completa || null,
        numar_copii: dg.numar_copii || detalii.numar_copii || null,
        personaj_dorit: detalii.personaj_dorit || null,
        durata_ore: detalii.durata_ore || null,
        interior_sau_exterior: dg.interior_sau_exterior || null,
        gata_pentru_oferta: comercial.gata_pentru_oferta || false,
    };

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
