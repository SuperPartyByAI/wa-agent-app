/**
 * Live Test V3 — AI Agent Autonom (toolConfig AUTO + phone context)
 */
import dotenv from 'dotenv';
dotenv.config();

import { processWithVertexAI } from './src/vertex/vertexClient.mjs';

const CLIENT_PHONE = '+40700TEST04';

async function send(msg) {
    console.log(`\n${'═'.repeat(70)}`);
    console.log(`👤 CLIENT: ${msg}`);
    console.log(`${'─'.repeat(70)}`);
    const result = await processWithVertexAI(CLIENT_PHONE, msg);
    console.log(`🤖 AI: ${result.reply}`);
    if (result.functionCall) {
        console.log(`\n   🔧 TOOL: ${result.functionCall.name}`);
        console.log(`   📋 ARGS:`, JSON.stringify(result.functionCall.args, null, 2));
        if (result.functionResult) {
            console.log(`   📦 RESULT:`, JSON.stringify(result.functionResult, null, 2));
        }
    } else {
        console.log(`   ℹ️  (no function call)`);
    }
    console.log(`   ⏱️  ${result.latencyMs}ms`);
    await new Promise(r => setTimeout(r, 1500));
    return result;
}

async function run() {
    console.log('🎬 TEST V3 — AI Agent Autonom (toolConfig AUTO)\n');

    // STEP 1: Cer petrecere cu toate detaliile
    console.log('📌 STEP 1: Creez petrecere cu detalii complete...');
    await send('Bună seara! Vreau o petrecere cu animație Elsa pe 25 martie 2026, ora 15:00, la Restaurant Pescăruș, 20 de copii. Copilul se numește Andrei și face 6 ani.');

    // STEP 2: Modific locația
    console.log('\n📌 STEP 2: Modific locația...');
    await send('Vreau să schimb locația. Nu mai e la Pescăruș, mutăm la Sala FunPark.');

    // STEP 3: Anulez
    console.log('\n📌 STEP 3: Anulez petrecerea...');
    await send('Trebuie să anulez petrecerea. S-a schimbat totul.');

    // STEP 4: Restaurez
    console.log('\n📌 STEP 4: Restaurez...');
    await send('M-am răzgândit, vreau totuși petrecerea anulată. O reactivați?');

    console.log(`\n${'═'.repeat(70)}\n🎬 TEST V3 COMPLET!\n${'═'.repeat(70)}`);
}

run().catch(err => { console.error('❌ FAILED:', err.message); process.exit(1); });
