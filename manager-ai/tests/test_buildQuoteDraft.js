import dotenv from 'dotenv';
dotenv.config({ path: '.env' });

import { buildQuoteDraft } from './src/quotes/buildQuoteDraft.mjs';

async function test() {
    const eventPlan = {
        id: 'test-evt-id',
        conversation_id: 'test-conv',
        client_id: 'test-client',
        requested_services: ['animator', 'vata_zahar'],
        selected_package: {
            package: 'super_3_confetti',
            duration: 2
        },
        transport_zone: 'bucuresti',
        children_count_estimate: 15,
        event_date: '2024-05-10',
        location: 'Bucuresti'
    };

    console.log("Building quote draft...");
    let quote = await buildQuoteDraft(eventPlan, { packageCode: eventPlan.selected_package.package });
    console.log("Result:", JSON.stringify(quote, null, 2));

    process.exit(0);
}

test();
