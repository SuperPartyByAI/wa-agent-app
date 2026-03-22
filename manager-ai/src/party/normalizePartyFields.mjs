/**
 * normalizePartyFields.mjs
 * 
 * Normalizes raw NLP extractions into strongly typed values.
 * e.g., converts '3 metri' -> 3 (number), 'da' -> true (boolean), 'nu stiu' -> null.
 */

export function normalizeValue(key, rawValue, expectedType) {
    if (rawValue === null || rawValue === undefined || rawValue === '') return null;
    
    // String normalization
    if (expectedType === 'string') {
        const str = String(rawValue).trim();
        // Ignore placeholders or unknown values mapping to empty
        if (str.toLowerCase() === 'nu_este_mentionat' || str.toLowerCase() === 'nu stiu' || str.toLowerCase() === 'none') return null;
        return str;
    }
    
    // Number normalization
    if (expectedType === 'number') {
        if (typeof rawValue === 'number') return rawValue;
        const numStr = String(rawValue).replace(/[^\d.,]/g, '').replace(',', '.');
        const parsed = parseFloat(numStr);
        return isNaN(parsed) ? null : parsed;
    }
    
    // Boolean normalization
    if (expectedType === 'boolean') {
        if (typeof rawValue === 'boolean') return rawValue;
        const s = String(rawValue).trim().toLowerCase();
        if (['da', 'yes', 'true', '1'].includes(s)) return true;
        if (['nu', 'no', 'false', '0'].includes(s)) return false;
        return null;
    }

    return rawValue; // Fallback
}
