import dotenv from 'dotenv';
dotenv.config();
process.env.VERTEX_AI_API_KEY = process.env.GEMINI_API_KEY || process.env.VERTEX_AI_API_KEY;
import { processWithVertexAI } from './src/vertex/vertexClient.mjs';

const TEST_PHONE = '+40700FRESH1BY5';

async function runTest() {
    console.log("=== TEST MOCK: VREAU O PETRECERE ===");
    let result = await processWithVertexAI(TEST_PHONE, "Bună ziua! Vreau și eu o petrecere pe 23 august pentru fetița mea.");
    console.log("\n[Răspuns AI]:", result?.reply);
    console.log("\n[Tool Calls]:", result?.debug?.functionCalls);

    console.log("\n\n=== OVERRIDE: DAU CATEVA DETALII, DAR NU PE TOATE ===");
    result = await processWithVertexAI(TEST_PHONE, "O vreau pe Elsa și cred că vor fi in jur de 10 copii. Va începe la ora 16:00.");
    console.log("\n[Răspuns AI]:", result?.reply);
    console.log("\n[Tool Calls]:", JSON.stringify(result?.debug?.functionCalls, null, 2));

    process.exit(0);
}

runTest();
