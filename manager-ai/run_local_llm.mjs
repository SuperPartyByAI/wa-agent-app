import { config } from 'dotenv';
config();
import { callLocalLLM } from './src/agent/llmEngine.mjs';

async function run() {
    try {
        console.log("Calling LLM Engine directly...");
        const res = await callLocalLLM("Esti asistent AI. Returneaza JSON cu { \"notebook_updates\": { \"nume\": \"Alex\" } }", "Alex este numele meu.");
        console.log("==== RESULT ====\n", JSON.stringify(res, null, 2));
    } catch(e) { console.error("TEST FAILED:", e); }
}
run();
