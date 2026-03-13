/**
 * generateContextPack.mjs
 * 
 * Reads the live Action Registry, current Git SHA, prompt version,
 * and Core API contract version, then serializes them into a JSON
 * Context Pack and publishes it to Supabase `ai_runtime_context`.
 * 
 * Usage:
 *   node --env-file=../.env src/grounding/generateContextPack.mjs
 * 
 * This should be run after every deploy or registry change.
 */

import { execSync } from 'child_process';
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } from '../config/env.mjs';
import { ACTION_REGISTRY, ActionRiskLevel } from '../actions/actionRegistry.mjs';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ── Versioning Constants ──
// Bump these manually when the corresponding contracts change.
export const REGISTRY_VERSION = '1.1.0';   // Bumped for hybrid grounding
export const PROMPT_VERSION = '2.0.0';     // Dual JSON format
export const CORE_API_CONTRACT_VERSION = '1.0.0';

/**
 * Generates a compact, serializable snapshot of the Action Registry.
 * This is what the agent reads to know "what tools exist and what they accept".
 */
export function buildRegistrySnapshot() {
    const snapshot = {};
    for (const [name, entry] of Object.entries(ACTION_REGISTRY)) {
        snapshot[name] = {
            description: entry.description,
            riskLevel: entry.riskLevel,
            requiredArgs: entry.schema?.required || [],
            optionalArgs: Object.keys(entry.schema?.properties || {}).filter(
                k => !(entry.schema?.required || []).includes(k)
            ),
            allowedGoalStates: entry.allowedGoalStates
        };
    }
    return snapshot;
}

/**
 * Gets the current Git commit SHA.
 */
function getGitSha() {
    try {
        return execSync('git rev-parse HEAD', { encoding: 'utf-8' }).trim();
    } catch {
        console.warn('[ContextPack] Could not read Git SHA, using "unknown"');
        return 'unknown';
    }
}

/**
 * Gets the current Git branch.
 */
function getGitBranch() {
    try {
        return execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf-8' }).trim();
    } catch {
        return 'unknown';
    }
}

/**
 * Generates the full Context Pack object.
 */
export function generateContextPack() {
    return {
        deployed_commit_sha: getGitSha(),
        source_branch: getGitBranch(),
        action_registry_snapshot: buildRegistrySnapshot(),
        action_registry_version: REGISTRY_VERSION,
        prompt_version: PROMPT_VERSION,
        core_api_contract_version: CORE_API_CONTRACT_VERSION,
        tool_names: Object.keys(ACTION_REGISTRY),
        tool_count: Object.keys(ACTION_REGISTRY).length,
        risk_levels_used: [...new Set(Object.values(ACTION_REGISTRY).map(e => e.riskLevel))],
        generated_at: new Date().toISOString()
    };
}

/**
 * Publishes the Context Pack to Supabase `ai_runtime_context`.
 * Deactivates any previous active record for the same environment,
 * then inserts the new one.
 */
export async function publishContextPack(environment = 'production') {
    const pack = generateContextPack();

    // Deactivate previous active records
    await supabase
        .from('ai_runtime_context')
        .update({ is_active: false })
        .eq('environment_name', environment)
        .eq('is_active', true);

    // Insert new active record
    const { data, error } = await supabase
        .from('ai_runtime_context')
        .insert({
            environment_name: environment,
            deployed_commit_sha: pack.deployed_commit_sha,
            source_branch: pack.source_branch,
            action_registry_snapshot: pack.action_registry_snapshot,
            action_registry_version: pack.action_registry_version,
            prompt_version: pack.prompt_version,
            core_api_contract_version: pack.core_api_contract_version,
            feature_flags: {},
            migration_status_snapshot: {},
            last_deployed_at: new Date().toISOString(),
            last_verified_at: new Date().toISOString(),
            is_active: true
        })
        .select()
        .single();

    if (error) {
        console.error('[ContextPack] Failed to publish:', error.message);
        throw error;
    }

    console.log(`[ContextPack] Published v${pack.action_registry_version} (SHA: ${pack.deployed_commit_sha.substring(0, 8)}) with ${pack.tool_count} tools`);
    return data;
}

// ── CLI Entry Point ──
// When run directly: generate + publish
const isDirectRun = process.argv[1]?.endsWith('generateContextPack.mjs');
if (isDirectRun) {
    console.log('[ContextPack] Generating and publishing...');
    const pack = generateContextPack();
    console.log('[ContextPack] Snapshot:', JSON.stringify(pack, null, 2));
    
    publishContextPack()
        .then(() => console.log('[ContextPack] Done.'))
        .catch(err => { console.error('[ContextPack] Fatal:', err); process.exit(1); });
}
