import dotenv from 'dotenv';
dotenv.config();
import { processWithVertexAI } from './src/vertex/vertexClient.mjs';

async function run() {
    console.log("Testing Rumi si Jinu Vertex AI Logic...");
    const sessionId = "test-rumi-" + Date.now();
    const result = await processWithVertexAI(
        "+40700000001",
        "Vreau si eu o petrecere de Animatie la gradinita Planeta Copiilor, str. Gabriela Szabo sector 6. Pe data de 24 Martie 2026, de la ora 10. Il vreau pe personajul Rumi si pe personajul Jinu",
        { isCrmLive: false },
        sessionId 
    );
    console.log("\n=== FUNCTION CALL RESULTS ===");
    console.log(JSON.stringify(result.functionCalls, null, 2));
}

run().catch(console.error);
