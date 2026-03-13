/**
 * loadRuntimeContext.mjs
 * 
 * Fetches the active Context Pack from Supabase `ai_runtime_context`
 * at pipeline start. Returns the context pack alongside drift detection.
 */

import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } from '../config/env.mjs';
import { detectDrift } from './detectDrift.mjs';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

/**
 * Loads the active runtime context (Context Pack) for the given environment.
 * 
 * @param {string} environment - defaults to 'production'
 * @returns {{ contextPack: object|null, drift: object }}
 */
export async function loadRuntimeContext(environment = 'production') {
    try {
        const { data, error } = await supabase
            .from('ai_runtime_context')
            .select('*')
            .eq('environment_name', environment)
            .eq('is_active', true)
            .maybeSingle();

        if (error) {
            console.warn('[RuntimeContext] Failed to load context pack:', error.message);
            return { contextPack: null, drift: { hasDrift: true, details: ['Failed to load context pack from Supabase'] } };
        }

        if (!data) {
            console.warn('[RuntimeContext] No active context pack found. Run generateContextPack.mjs first.');
            return { contextPack: null, drift: { hasDrift: true, details: ['No active context pack in Supabase'] } };
        }

        // Run drift detection against live registry
        const drift = detectDrift(data.action_registry_snapshot);

        if (drift.hasDrift) {
            console.warn(`[RuntimeContext] ⚠️  Drift detected:`, drift.details);
        } else {
            console.log(`[RuntimeContext] Context pack loaded: v${data.action_registry_version} (SHA: ${(data.deployed_commit_sha || '').substring(0, 8)})`);
        }

        return { contextPack: data, drift };
    } catch (err) {
        console.error('[RuntimeContext] Unexpected error:', err.message);
        return { contextPack: null, drift: { hasDrift: true, details: [err.message] } };
    }
}
