import dotenv from 'dotenv';
import { processWithVertexAI } from './vertexClient.mjs';

dotenv.config({ path: '/Users/universparty/wa-web-launcher/wa-agent-app/manager-ai/.env' });

async function run() {
    const testMessage = "Buna ziua. Vreau o ursitoare.";
    const result = await processWithVertexAI("+40700000888", testMessage, { isCrmLive: false });
    console.log(JSON.stringify(result.functionCall, null, 2));
    process.exit(0);
}
run();
