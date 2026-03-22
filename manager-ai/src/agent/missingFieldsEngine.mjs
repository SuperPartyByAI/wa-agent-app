import { getServiceDef } from '../lib/serviceRequirementsEngine.mjs';

/**
 * MISSING FIELDS ENGINE
 * Responsible for calculating exact metadata gaps to fuel the Next Best Action Planner.
 */

// Global generic fallbacks if a service isn't found in catalog
const FALLBACK_REQUIRED_FIELDS = ['event_date', 'location'];

/**
 * Calculates what fields are required, known, and missing for a given service and event plan state.
 *
 * @param {string} primaryService The main service key (e.g. 'vata_zahar', 'arcada_fara_suport')
 * @param {object} eventPlan The raw row from `ai_event_plans`
 * @param {object} runtimeKnownFields Optional overrides from the runtime state
 * @returns {object} { known: [], missing: [], allRequired: [], nextFieldToAsk: string|null }
 */
export function computeMissingFields(primaryService, eventPlan = {}, runtimeKnownFields = {}) {
    let allRequired = [...FALLBACK_REQUIRED_FIELDS];
    const svcDef = primaryService ? getServiceDef(primaryService) : null;

    if (svcDef && svcDef.required_fields) {
        allRequired = [...svcDef.required_fields];
    } else if (primaryService) {
        // Safe mapping if role registry doesn't perfectly match catalog
        if (primaryService.includes('arcada')) {
            allRequired = ['event_date', 'location'];
            if (!primaryService.includes('suport') || primaryService === 'arcada_fara_suport' || primaryService === 'arcada_cu_cifre_volumetrice') {
                allRequired.push('linear_meters', 'model_choice');
            }
        } else if (primaryService.includes('animat') || primaryService.includes('ursitoare')) {
            allRequired.push('duration_hours');
        } else if (primaryService.includes('vata') || primaryService.includes('popcorn') || primaryService.includes('cabina') || primaryService.includes('vata_si_popcorn')) {
            allRequired.push('duration_hours');
        }
    }

    // Merge knowledge
    const mergedData = { ...eventPlan, ...runtimeKnownFields };
    
    // Normalize aliases for checking presence
    const checkMap = {
        'data_eveniment': ['event_date', 'date'],
        'locatie': ['location', 'city'],
        'durata_ore': ['duration_hours'],
        'liniari': ['linear_meters'],
        'metri_liniari': ['linear_meters'],
        'linear_meters': ['linear_meters'],
        'model_choice': ['model_choice'],
        'nr_copii': ['children_count_estimate'],
        'interval_orar': ['event_time'],
        'varsta_copil': ['child_age']
    };

    const known = [];
    const missing = [];

    for (const req of allRequired) {
        let isKnown = false;
        
        // Exact DB column match
        if (hasValue(mergedData[req])) {
            isKnown = true;
        } else {
            // Check aliases if defined
            const aliases = checkMap[req] || [req];
            for (const alias of aliases) {
                if (hasValue(mergedData[alias])) {
                    isKnown = true;
                    break;
                }
            }
        }

        if (isKnown) {
            known.push(req);
        } else {
            missing.push(req);
        }
    }

    // Determine the next strategic field to ask for
    let nextFieldToAsk = missing.length > 0 ? missing[0] : null;

    return {
        allRequired,
        known,
        missing,
        nextFieldToAsk,
        readyForQuote: missing.length === 0
    };
}

function hasValue(val) {
    return val !== undefined && val !== null && val !== '' && !(Array.isArray(val) && val.length === 0);
}
