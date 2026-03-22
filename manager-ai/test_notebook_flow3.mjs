import { config } from 'dotenv';
config();
import { callLocalLLM } from './src/llm/client.mjs'; // Correct path for llm client based on typical Superparty architecture or I'll just find it.
import fs from 'fs';

// Find the real llm client path first
const possiblePaths = [
  './src/llm/client.mjs',
  './src/agent/llm_engine.mjs',
  './src/utils/llm.mjs',
  './src/llmClient.mjs',
  './src/agent/llmProxy.mjs'
];
let importPath = '';
for (let p of possiblePaths) {
  if (fs.existsSync(p)) {
    importPath = p;
    break;
  }
}
console.log("Found LLM at:", importPath || "Not found natively");
