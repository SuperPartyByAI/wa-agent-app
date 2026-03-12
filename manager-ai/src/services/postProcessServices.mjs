import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load catalog once at startup
export const SERVICE_CATALOG = JSON.parse(
    readFileSync(join(__dirname, 'catalog.json'), 'utf8')
);

export const CATALOG_MAP = {};
SERVICE_CATALOG.services.forEach(s => { CATALOG_MAP[s.service_key] = s; });

export const SERVICE_KEYS = SERVICE_CATALOG.services.map(s => s.service_key);

/**
 * Build a concise catalog summary for injection into SYSTEM_PROMPT.
 */
export function buildCatalogPromptBlock() {
    return SERVICE_CATALOG.services.map(s =>
        `- ${s.service_key} (${s.display_name}): ${s.description}\n  Campuri obligatorii: ${s.required_fields.join(', ')}\n  Campuri optionale: ${s.optional_fields.join(', ')}`
    ).join('\n');
}

/**
 * Post-process LLM-extracted services using the canonical catalog.
 * Validates selected_services, computes precise missing fields, builds cross-sell.
 */
export function postProcessServices(analysis) {
    const rawSelected = analysis.selected_services || [];
    const validSelected = rawSelected.filter(key => CATALOG_MAP[key]);

    // Build precise missing_fields_per_service from catalog
    const missingPerService = {};
    const serviceReqs = analysis.service_requirements || {};

    for (const key of validSelected) {
        const catalogEntry = CATALOG_MAP[key];
        const extracted = serviceReqs[key]?.extracted_fields || {};

        const missing = catalogEntry.required_fields.filter(field => {
            const val = extracted[field];
            return val === null || val === undefined || val === '' || val === 'null';
        });

        missingPerService[key] = missing;
    }

    // Build cross-sell from catalog (services not selected but linked)
    const crossSell = new Set();
    for (const key of validSelected) {
        const catalogEntry = CATALOG_MAP[key];
        for (const linked of (catalogEntry.cross_sell_services || [])) {
            if (!validSelected.includes(linked) && CATALOG_MAP[linked]) {
                crossSell.add(linked);
            }
        }
    }

    // Check human_review_triggers
    let shouldForceReview = false;
    for (const key of validSelected) {
        const catalogEntry = CATALOG_MAP[key];
        if (!catalogEntry.autonomy_allowed) {
            shouldForceReview = true;
        }
    }

    return {
        selected_services: validSelected,
        missing_fields_per_service: missingPerService,
        cross_sell_opportunities: [...crossSell],
        should_force_review: shouldForceReview,
        catalog_map: CATALOG_MAP
    };
}

console.log(`[Service Catalog] Loaded ${SERVICE_CATALOG.services.length} services (v${SERVICE_CATALOG.version}): ${SERVICE_KEYS.join(', ')}`);
