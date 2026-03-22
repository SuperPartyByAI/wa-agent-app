import { computeNextBestAction, NBA_ACTIONS } from './src/agent/nextBestActionPlanner.mjs';

function runPlaybookTest(name, context) {
    console.log(`\n================================`);
    console.log(`[▶️ START] TEST: ${name}`);
    console.log(`[💬 MSG] "${context.clientMessageText}"`);
    console.log(`================================`);

    const result = computeNextBestAction(context);
    
    console.log(`[NBA Action] ${result.action}`);
    console.log(`[Next State] ${result.nextState}`);
    console.log(`[Instruction]\n${result.instruction}`);
    
    if (result.instruction.includes('[PLAYBOOK OVERRIDE')) {
        console.log(`\n✅ PLAYBOOK STRATEGY INJECTED SUCCESSFULLY`);
    } else {
        console.log(`\n⚠️ NO PLAYBOOK STRATEGY (FALLBACK USED)`);
    }
}

// 1. Vague Inquiry (Nu stiu exact, vreau ceva la aniversare)
runPlaybookTest("VAGUE INQUIRY", {
    isGreeting: false,
    clientMessageText: "Nu prea stiu, facem o aniversare si vrem ceva dragut",
    runtimeState: { primary_service: null, lead_state: 'identificare_serviciu' }
});

// 2. Impatient Price (Cat costa aia la Ilfov?) - dar fara date complete!
runPlaybookTest("IMPATIENT PRICE (Lacking Fields)", {
    isGreeting: false,
    clientMessageText: "Cat costa ursitoarele in Ilfov?",
    runtimeState: { primary_service: 'ursitoare', lead_state: 'colectare_date' },
    missingMetrics: { 
        readyForQuote: false, 
        nextFieldToAsk: 'data_evenimentului', 
        missing: ['data_evenimentului', 'ora_evenimentului'] 
    }
});

// 3. Objection: Too Expensive
runPlaybookTest("OBJECTION: TOO EXPENSIVE", {
    isGreeting: false,
    clientMessageText: "Hmm e cam scump 400 de lei pentru o ora",
    runtimeState: { primary_service: 'animatie', lead_state: 'oferta_trimisa' },
    missingMetrics: { readyForQuote: true }
});

// 4. Objection: Thinking About It
runPlaybookTest("OBJECTION: THINKING", {
    isGreeting: false,
    clientMessageText: "Ok mutumesc, vorbesc cu soțul și vă anunț.",
    runtimeState: { primary_service: 'vata_de_zahar', lead_state: 'oferta_trimisa' },
    missingMetrics: { readyForQuote: true }
});

// 5. Upsell (Hot Lead post-offer)
runPlaybookTest("UPSELL (Hot Lead)", {
    isGreeting: false,
    clientMessageText: "Da, suntem de acord cu pretul, vrem rezervarea fermă",
    runtimeState: { primary_service: 'animatie', lead_state: 'oferta_trimisa', lead_score: 90 },
    missingMetrics: { readyForQuote: true }
});
