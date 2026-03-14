/**
 * Policy Simulator — Test payloads against loaded policy
 *
 * Run: node scripts/simulate-policy.mjs
 * Ticket: stabilizare/antigravity - Policy Simulation
 */

import fs from 'fs';

const policyPath = process.argv[2] || 'runtime_rules/policy.json';

// Test payloads
const testCases = [
    { name: 'Greeting', message: 'Buna ziua!', stage: 'DISCOVERY', expected_match: false },
    { name: 'Costume query', message: 'Aveti costum Spiderman?', stage: 'DISCOVERY', expected_trigger: 'COSTUME_QUERY' },
    { name: 'Price question', message: 'Cat costa animatorul?', stage: 'DISCOVERY', expected_trigger: 'PRICE_QUESTION' },
    { name: 'Reschedule', message: 'Putem muta petrecerea?', stage: 'COORDINATION', expected_trigger: 'RESCHEDULE' },
    { name: 'Complaint', message: 'Sunt nemultumit de servicii', stage: 'ANY', expected_trigger: 'COMPLAINT' },
    { name: 'Normal booking', message: 'Vreau o rezervare pentru sambata', stage: 'DISCOVERY', expected_match: false },
    { name: 'Location question', message: 'Veniti si in Ilfov?', stage: 'DISCOVERY', expected_match: false }
];

function matchRule(rules, message, stage) {
    return rules.filter(rule => {
        if (rule.stage && rule.stage !== stage && rule.stage !== 'ANY') return false;
        if (rule.trigger) {
            const trigger = rule.trigger.toLowerCase().replace(/_/g, ' ');
            const msg = message.toLowerCase();
            // Simplified matching — in production this would use NLP
            const keywords = {
                'costume_query': ['costum', 'personaj', 'mascota'],
                'price_question': ['costa', 'pret', 'tarif', 'cat costa'],
                'reschedule': ['muta', 'reprograma', 'amana', 'schimba data'],
                'complaint': ['nemultumit', 'plangere', 'problema', 'reclama']
            };
            const kws = keywords[rule.trigger.toLowerCase()] || [trigger];
            if (!kws.some(kw => msg.includes(kw))) return false;
        }
        return true;
    }).sort((a, b) => (b.priority || 0) - (a.priority || 0));
}

// Main
try {
    const policy = JSON.parse(fs.readFileSync(policyPath, 'utf8'));
    console.log(`Policy: ${policy.version} (${policy.rules?.length || 0} rules)`);
    console.log('─'.repeat(70));

    let passed = 0;
    let failed = 0;

    for (const tc of testCases) {
        const matches = matchRule(policy.rules || [], tc.message, tc.stage);
        const matched = matches.length > 0;
        const firstMatch = matches[0];

        let ok = false;
        if (tc.expected_match === false) {
            ok = !matched;
        } else if (tc.expected_trigger) {
            ok = matched && firstMatch?.trigger === tc.expected_trigger;
        } else {
            ok = matched;
        }

        const status = ok ? '✅' : '❌';
        console.log(`${status} ${tc.name}`);
        console.log(`   Input: "${tc.message}" [${tc.stage}]`);
        console.log(`   Match: ${matched ? `${firstMatch.name} (${firstMatch.behavior})` : 'none'}`);

        if (ok) passed++;
        else failed++;
    }

    console.log('─'.repeat(70));
    console.log(`Results: ${passed}/${testCases.length} passed, ${failed} failed`);

    if (failed > 0) {
        console.error('\n❌ SIMULATION HAS FAILURES');
        process.exit(2);
    }

    console.log('\n✅ All simulations passed');
    process.exit(0);
} catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
}
