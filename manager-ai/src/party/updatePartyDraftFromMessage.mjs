import { normalizeValue } from './normalizePartyFields.mjs';
import { GeneralPartyFields, BillingFields, ServiceFieldRequirements } from './partyFieldRegistry.mjs';

/**
 * updatePartyDraftFromMessage.mjs
 * 
 * Merges raw LLM extractions (e.g. from the planner/NLP) into the persistent Party Draft.
 * Uses the field registry dictionaries to cleanly categorize data into generalized logic,
 * billing info, or service-specific detail slices.
 */
export function updatePartyDraftFromMessage(partyDraft, rawExtractedData, activeRoles = []) {
    if (!rawExtractedData || typeof rawExtractedData !== 'object') return partyDraft;

    // 1. Update general fields
    GeneralPartyFields.forEach(field => {
        if (rawExtractedData[field.key] !== undefined) {
            const normalized = normalizeValue(field.key, rawExtractedData[field.key], field.type);
            if (normalized !== null) {
                partyDraft.date_generale[field.key] = normalized;
            }
        }
    });

    // 2. Update billing fields
    BillingFields.forEach(field => {
        if (rawExtractedData[field.key] !== undefined) {
            // Assume string unless 'doreste_factura'
            const type = field.key === 'doreste_factura' ? 'boolean' : 'string';
            const normalized = normalizeValue(field.key, rawExtractedData[field.key], type);
            if (normalized !== null) {
                partyDraft.facturare[field.key] = normalized;
            }
        }
    });

    // 3. Update service-specific details selectively for active roles
    activeRoles.forEach(roleKey => {
         const specs = ServiceFieldRequirements[roleKey];
         if (!specs) return;
         
         // Init object block if missing
         if (!partyDraft.detalii_servicii[specs.serviceKey]) {
             partyDraft.detalii_servicii[specs.serviceKey] = {};
         }
         
         // Loop specific schema requirements for this service
         Object.keys(specs.detailsSchema).forEach(detailKey => {
             if (rawExtractedData[detailKey] !== undefined) {
                 const expectedType = specs.detailsSchema[detailKey];
                 const normalized = normalizeValue(detailKey, rawExtractedData[detailKey], expectedType);
                 if (normalized !== null) {
                     partyDraft.detalii_servicii[specs.serviceKey][detailKey] = normalized;
                 }
             }
         });
    });

    return partyDraft;
}
