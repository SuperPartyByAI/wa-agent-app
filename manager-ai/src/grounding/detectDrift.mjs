/**
 * detectDrift.mjs
 * 
 * Compares the live ACTION_REGISTRY (running code) against the stored
 * Context Pack snapshot to detect any mismatches.
 * 
 * Drift means the deployed code has changed but the Context Pack
 * has not been regenerated. The live code is always the authority;
 * drift is logged but does not block execution.
 */

import { ACTION_REGISTRY } from '../actions/actionRegistry.mjs';

/**
 * Detects drift between the live code registry and the stored snapshot.
 * 
 * @param {object} storedSnapshot - The `action_registry_snapshot` from Supabase
 * @returns {{ hasDrift: boolean, details: string[] }}
 */
export function detectDrift(storedSnapshot) {
    const details = [];

    if (!storedSnapshot || typeof storedSnapshot !== 'object') {
        return { hasDrift: true, details: ['Stored snapshot is null or invalid'] };
    }

    const liveToolNames = Object.keys(ACTION_REGISTRY);
    const storedToolNames = Object.keys(storedSnapshot);

    // Check for tools in live code that are missing from snapshot
    for (const tool of liveToolNames) {
        if (!storedToolNames.includes(tool)) {
            details.push(`Tool '${tool}' exists in live code but NOT in context pack`);
        }
    }

    // Check for tools in snapshot that are missing from live code
    for (const tool of storedToolNames) {
        if (!liveToolNames.includes(tool)) {
            details.push(`Tool '${tool}' exists in context pack but NOT in live code`);
        }
    }

    // Check for schema/risk mismatches on shared tools
    for (const tool of liveToolNames) {
        if (!storedSnapshot[tool]) continue;

        const liveEntry = ACTION_REGISTRY[tool];
        const storedEntry = storedSnapshot[tool];

        if (liveEntry.riskLevel !== storedEntry.riskLevel) {
            details.push(`Tool '${tool}': risk level drift (live=${liveEntry.riskLevel}, stored=${storedEntry.riskLevel})`);
        }

        const liveRequired = liveEntry.schema?.required || [];
        const storedRequired = storedEntry.requiredArgs || [];
        if (JSON.stringify(liveRequired.sort()) !== JSON.stringify(storedRequired.sort())) {
            details.push(`Tool '${tool}': required args drift`);
        }
    }

    return {
        hasDrift: details.length > 0,
        details
    };
}
