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

    // Check Level 1 (Quote Requirements)
    reqs.level1_quote.forEach(field => {
        if (!hasField(field)) missingForQuote.push(field);
    });

    // Check Level 2 (Booking Requirements)
    reqs.level2_booking.forEach(field => {
        if (!hasField(field)) missingForBooking.push(field);
    });
    
    const combinedBooking = [...new Set([...missingForQuote, ...missingForBooking])];

    // Compute Next Field To Ask based on Recommended Order
    let nextFieldToAsk = null;
    if (reqs.recommendedOrder) {
        for (const field of reqs.recommendedOrder) {
            // Priority: if it's missing for quote OR booking, ask it
            if (missingForQuote.includes(field) || missingForBooking.includes(field)) {
                nextFieldToAsk = field;
                break;
            }
        }
    }
    
    // Fallback if recommendedOrder didn't catch it
    if (!nextFieldToAsk && missingForQuote.length > 0) nextFieldToAsk = missingForQuote[0];
    if (!nextFieldToAsk && combinedBooking.length > 0) nextFieldToAsk = combinedBooking[0];

    return {
        missingForQuote,
        missingForBooking: combinedBooking,
        isReadyForQuote: missingForQuote.length === 0,
        isReadyForBooking: combinedBooking.length === 0,
        allowedOptionals: reqs.optionals,
        
        // --- Legacy Interface Mapping for nextBestActionPlanner ---
        readyForQuote: missingForQuote.length === 0,
        missing: missingForQuote.length > 0 ? missingForQuote : missingForBooking,
        nextFieldToAsk: nextFieldToAsk
    };
}
