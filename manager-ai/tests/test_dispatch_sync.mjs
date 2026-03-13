import assert from 'assert';
import { dispatchBookingToCore } from '../src/api/coreApiClient.mjs';

// Simple unit test for dispatchBookingToCore
async function runTest() {
    console.log('[Test] Starting Core API Command Dispatch Test...');

    // 1. Mock global.fetch to intercept the request
    let capturedUrl = '';
    let capturedOptions = {};

    global.fetch = async (url, options) => {
        capturedUrl = url;
        capturedOptions = options;
        
        // Return a mock successful response
        return {
            ok: true,
            json: async () => ({ success: true, booking_id: 'mock-1234' })
        };
    };

    // 2. Prepare mock AI Event Plan payload
    const mockPayload = {
        ai_event_plan_id: '11111111-2222-3333-4444-555555555555',
        client_id: 'client-999',
        conversation_id: 'conv-888',
        operator_locked: false,
        quote: {
            id: 'quote-777',
            total: 840,
            packages: ['super_3_confetti']
        },
        plan_details: {
            date: '20 aprilie',
            time: '17:00',
            location: 'Bucuresti',
            children_count_estimate: 12,
            duration_hours: 2,
            animator_count: 1,
            payment_method: 'transfer',
            invoice_requested: 'false',
            advance_status: 'requested',
            child_name: 'Mihai'
        }
    };

    // 3. Dispatch
    const result = await dispatchBookingToCore(mockPayload);

    // 4. Validate
    try {
        assert.strictEqual(result.success, true, 'Dispatch should return success=true');
        assert.strictEqual(result.booking_id, 'mock-1234', 'Dispatch should return the mocked booking_id');

        assert.ok(capturedUrl.includes('/api/internal/ai-sync'), 'URL should point to internal sync endpoint');
        assert.strictEqual(capturedOptions.method, 'POST', 'HTTP method must be POST');
        assert.ok(capturedOptions.headers['Authorization'].startsWith('Bearer '), 'Must include Bearer token');
        
        const body = JSON.parse(capturedOptions.body);
        assert.strictEqual(body.command, 'confirm_booking_from_ai_plan', 'Command missing or incorrect');
        assert.strictEqual(body.source, 'manager-ai', 'Source must be manager-ai');
        assert.deepStrictEqual(body.plan_details, mockPayload.plan_details, 'Plan details should match exactly');
        assert.strictEqual(body.plan_details.child_name, 'Mihai');
        
        console.log('[Test] SUCCESS: Dispatch payload correctly formatted and sent.');
        process.exit(0);
    } catch (err) {
        console.error('[Test] FAIL: Validation error', err);
        process.exit(1);
    }
}

runTest();
