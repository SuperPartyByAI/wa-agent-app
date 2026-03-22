import dotenv from 'dotenv';
dotenv.config({ path: '../backend/.env' });

import { processWithVertexAI } from './src/vertex/vertexClient.mjs';

const TEST_PHONE = '+40700FRESH1BY6'; // unique session

async function runTest() {
    console.log("=== TEST MOCK: VREAU O PETRECERE ===");
    let result = await processWithVertexAI(TEST_PHONE, "Bună ziua! Vreau și eu o petrecere pe 23 august. O vreau pe Elsa.", { forceTools: false });
    
    console.log("\n[Răspuns AI Text]:\n", result?.text);
    console.log("\n[Tool Calls]:", JSON.stringify(result?.functionCalls, null, 2));

    process.exit(0);
}

runTest();
