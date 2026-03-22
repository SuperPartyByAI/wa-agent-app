import { processWithVertexAI } from './src/vertex/vertexClient.mjs';
import dotenv from 'dotenv';
dotenv.config();

async function run() {
    console.log("Testing Vertex AI Multi-Character Logic...");
    // Mock user wanting 2 characters
    const res = await processWithVertexAI('+40700000000', 'Buna, vreau o petrecere saptamana viitoare joi! Vreau animatie cu Mickey Mouse si Elsa.', { tools: true, forceTools: true });
    console.log("Final Reply:", res.reply);
    console.log("Functions Called:");
    res.functionCalls?.forEach(f => console.log(f.name, f.args));
}
run();
