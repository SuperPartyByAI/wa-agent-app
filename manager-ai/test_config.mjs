import { loadSystemPrompt } from './src/vertex/vertexClient.mjs';
async function test() {
    const prompt = await loadSystemPrompt();
    console.log("--- SYSTEM PROMPT ---");
    console.log(prompt);
    console.log("---------------------");
    process.exit(0);
}
test();
