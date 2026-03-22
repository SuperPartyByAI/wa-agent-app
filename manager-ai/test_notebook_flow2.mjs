import { config } from 'dotenv';
config();
import { callLocalLLM } from './src/agent/llmClient.mjs';
import { getActiveNotebook, buildNotebookPromptSection } from './src/agent/notebookFiller.mjs';

async function run() {
  console.log("Simulating Notebook Payload...");
  try {
     const nbContext = await getActiveNotebook("+40700000000", "animator");
     console.log("Found Notebook:", JSON.stringify(nbContext, null, 2));
     
     const promptExtra = buildNotebookPromptSection(nbContext);
     console.log("Generated Prompt Block:\n", promptExtra);
     
     const mockSys = "Esti asistent AI. Extrage json cu assistant_reply si notebook_updates.\n" + promptExtra;
     console.log("Calling Gemini with test text...");
     const result = await callLocalLLM(mockSys, "Salut, vreau un animator pentru David care face 5 ani la Gymboland");
     console.log("==== RESULT ====\n", typeof result === 'object' ? JSON.stringify(result, null, 2) : result);
  } catch(e) { console.error("FATAL ERROR:", e); }
}
run();
