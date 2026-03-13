import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } from '../config/env.mjs';

/**
 * Dispatches a booking confirmation intent from the AI Engine to the Core API.
 * This ensures manager-ai does not write directly to operational tables.
 * 
 * @param {object} payload
 * @param {string} payload.ai_event_plan_id
 * @param {string} payload.client_id
 * @param {string} payload.conversation_id
 * @param {boolean} payload.operator_locked
 * @param {object} payload.quote (optional)
 * @param {object} payload.plan_details (optional)
 */
export async function dispatchBookingToCore(payload) {
    if (!payload.ai_event_plan_id) {
        throw new Error('Missing ai_event_plan_id in dispatch payload');
    }

    const commandPayload = {
        command: "confirm_booking_from_ai_plan",
        ...payload,
        source: 'manager-ai',
        timestamp: new Date().toISOString()
    };

    console.log(`[CoreApiClient] Dispatching ${commandPayload.command} for plan ${payload.ai_event_plan_id}...`);

    try {
        // We will call the internal core API. Since manager-ai and core-api often run on the same VPC
        // or machine, we point to localhost:3000 (standard backend port).
        // This can be externalized to an env var (CORE_API_URL) in the future.
        const CORE_API_URL = process.env.CORE_API_URL || 'http://localhost:3000';
        
        const response = await fetch(`${CORE_API_URL}/api/internal/ai-sync`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                // Shared secret between microservices. We reuse SUPABASE_SERVICE_ROLE_KEY as a generic trusted internal token for now.
                'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` 
            },
            body: JSON.stringify(commandPayload)
        });

        if (!response.ok) {
            const errText = await response.text();
            console.error(`[CoreApiClient] Dispatch failed with status ${response.status}: ${errText}`);
            return { success: false, error: `API HTTP ${response.status}`, details: errText };
        }

        const result = await response.json();
        console.log(`[CoreApiClient] Dispatch succeeded: ${JSON.stringify(result)}`);
        return { success: true, ...result };

    } catch (error) {
        console.error(`[CoreApiClient] Dispatch error (Network/Timeout):`, error.message);
        return { success: false, error: 'NetworkError', details: error.message };
    }
}
