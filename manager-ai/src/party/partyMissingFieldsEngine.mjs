import { getRequirementsForRoles } from './partyFieldRegistry.mjs';

/**
 * partyMissingFieldsEngine.mjs (v2)
 * 
 * Computes explicitly what fields are still missing to achieve Level 1 (Quote) 
 * and Level 2 (Booking) readiness, based on the current Event Dossier state.
 */
export function computeMissingPartyFields(partyDraft, activeRoleKeys = []) {
    const reqs = getRequirementsForRoles(activeRoleKeys);
    
    const missingForQuote = [];
    const missingForBooking = [];

    // Helper to check if a key exists and is not null/empty in the draft structure
    const hasField = (key) => {
        if (partyDraft.date_generale && partyDraft.date_generale[key]) return true;
        if (partyDraft.facturare && partyDraft.facturare[key] !== undefined && partyDraft.facturare[key] !== null) return true;
        
        // Scan deep inside active service detail blocks
        if (partyDraft.detalii_servicii) {
            for (const details of Object.values(partyDraft.detalii_servicii)) {
                if (details && details[key] !== undefined && details[key] !== null) return true;
            }
        }
        return false;
    };

    // 1. Check Level 1 (Quote Requirements)
    reqs.level1_quote.forEach(field => {
        if (!hasField(field)) missingForQuote.push(field);
    });

    // 2. Check Level 2 (Booking Requirements)
    // Booking implies everything from Quoting + Finalization details
    reqs.level2_booking.forEach(field => {
        if (!hasField(field)) missingForBooking.push(field);
    });
    
    // Ensure combined array for final Booking Readiness check
    const combinedBooking = [...new Set([...missingForQuote, ...missingForBooking])];

    return {
        missingForQuote,
        missingForBooking: combinedBooking,
        isReadyForQuote: missingForQuote.length === 0,
        isReadyForBooking: combinedBooking.length === 0,
        allowedOptionals: reqs.optionals
    };
}
