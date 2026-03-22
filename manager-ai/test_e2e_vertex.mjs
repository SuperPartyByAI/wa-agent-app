import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const mainDb = createClient(SUPABASE_URL, SUPABASE_KEY);

async function testE2E() {
    // 1. Gasim primul client existent din DB
    const { data: clients } = await mainDb.from('clients').select('id, real_phone_e164').not('real_phone_e164', 'is', null).limit(1);
    if (!clients || clients.length === 0) {
        return console.log("Nu am gasit clienti in DB!");
    }
    const testPhone = clients[0].real_phone_e164;
    console.log("Folosesc telefonul real:", testPhone);
    
    // Importam modulele necesare
    const { processWithVertexAI } = await import('./src/vertex/vertexClient.mjs');
    const { executeFunctionCall } = await import('./src/vertex/vertexClient.mjs');
    
    // Rulam un test pe bune
    try {
        const response = await processWithVertexAI(testPhone, "Salut! Vreau si eu o petrecere pentru baietelul meu. Ma intereseaza o masiva mega-aniversare cu Omul Paianjen, pe data de 15 Iulie.", {
            forceTools: true
        });
        console.log("Response text:", response.text);
        console.log("Function Calls:", JSON.stringify(response.functionCalls, null, 2));

        if (response.functionCalls && response.functionCalls[0]) {
            console.log("Executing tool...");
            // Need to pass the params.
            // executeFunctionCall is not exported from vertexClient.mjs?
            // Wait, we can test it directly by processWithVertexAI which returns functionCalls but doesn't execute them.
            // processWithVertexAI is the main pipeline. 
            // In the actual system, the tool calling execution is done in manager-ai/webhook logic.
        }
    } catch(err) {
        console.error("Eroare la procesare:", err);
    }
}

testE2E();
