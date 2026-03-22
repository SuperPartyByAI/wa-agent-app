import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { readFileSync, writeFileSync } from 'fs';
dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const GEMINI_API_KEY = process.env.VERTEX_AI_API_KEY || "AIzaSyBWTtBQ6JCVSsQ7SAbQPqwWapVMLHKev_Q";

// Helper LLM call
async function callLLM(prompt) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;
    try {
        const payload = {
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { responseMimeType: "application/json" }
        };
        const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        if (!res.ok) throw new Error(await res.text());
        const json = await res.json();
        return JSON.parse(json.candidates[0].content.parts[0].text);
    } catch (e) {
        console.error("LLM Error:", e.message);
        return null;
    }
}

// System Prompt core (condensed from worker for exact accuracy)
const CATALOG_BLOCK = readFileSync('./src/services/catalog.json', 'utf8');
const createPrompt = (transcript) => `Esti asistentul AI al Superparty. Analizeaza conversatia WhatsApp de mai jos. 
Extrage detaliile si alege raspunsul cerandu-i STRICT informatiile lipsa conform catalogului.
Toate campurile din JSON in limba romana.
Max 3 propozitii, cald si prietenos.

=== CATALOG ===
${CATALOG_BLOCK}
=== END CATALOG ===

CONVERSATIE:
${transcript}

Returneaza STRICT formatul:
{
  "event_draft": { "draft_type": "tip", "structured_data": {}, "missing_fields": [] },
  "suggested_reply": "text de trimis clientului",
  "decision": { "confidence_score": 0, "needs_human_review": false, "can_auto_reply": true }
}`;

async function runSimulation() {
    // 1. Get recent convo by finding the latest message
    const { data: latestMsg } = await supabase.from('messages')
        .select('conversation_id')
        .order('created_at', { ascending: false })
        .limit(1);
        
    if (!latestMsg || latestMsg.length === 0) return console.log("No messages found.");
    const convId = latestMsg[0].conversation_id;
    
    const { data: convData } = await supabase.from('conversations').select('id, contact_name, client_id').eq('id', convId).single();
    if (!convData) console.log("Conv metadata missing, proceeding with raw messages...");
    
    const clientRef = convData ? (convData.contact_name || convData.client_id) : convId;
    console.log("Simulating conversation with:", clientRef);
    
    // 2. Fetch MSGs
    const { data: msgs } = await supabase.from('messages')
        .select('sender_type, content, created_at')
        .eq('conversation_id', convId)
        .order('created_at', { ascending: true });

    let artifactsMD = `# Simulare Gândire AI: ${clientRef}\n\n`;
    artifactsMD += `Aceasta simulare arata **pas cu pas** cum ar fi reactionat robotul la fiecare mesaj nou venit de la client, considerand contextul de pana in acel punct.\n\n`;
    
    // 3. Playback
    let runMsgs = [];
    let step = 1;
    
    for (let i = 0; i < msgs.length; i++) {
        const m = msgs[i];
        runMsgs.push(m);
        
        // Simulam doar in momentul in care CLIENTUL a trimis ceva, pentru ca asa s-ar trage webhook-ul.
        if (m.sender_type === 'client') {
            const transcript = runMsgs.map(x => `${x.sender_type.toUpperCase()}: ${x.content}`).join("\\n");
            process.stdout.write(`Step ${step} / Message ${i+1}... `);
            const aiBrain = await callLLM(createPrompt(transcript));
            
            if (aiBrain) {
                artifactsMD += `## Pasul ${step}: Dupa mesajul clientului "${m.content.substring(0, 50)}..."\n`;
                artifactsMD += `> **🧠 Gândirea AI (Confidence: ${aiBrain.decision.confidence_score}%)**  \n`;
                artifactsMD += `> ${aiBrain.decision.can_auto_reply ? "🟢 Ar fi dat mesaj automat!" : "🔴 Ar fi cerut supervizare humana."}\n\n`;
                artifactsMD += `**GURA (Ce mesaj ar fi trimis):**\n\`\`\`\n${aiBrain.suggested_reply}\n\`\`\`\n\n`;
                artifactsMD += `**OCHII (Ce a dedus despre petrecere):**\n\`\`\`json\n${JSON.stringify(aiBrain.event_draft, null, 2)}\n\`\`\`\n\n`;
                artifactsMD += `---\n\n`;
                console.log("Done");
            } else {
                console.log("Failed");
            }
            step++;
            
            // Limit to last 7 steps to avoid rate limits
            if (step > 15) break; 
        }
    }
    
    writeFileSync("/Users/universparty/.gemini/antigravity/brain/6cb8bf81-4f7e-4e47-a016-a1f9ae6ad85e/conversation_simulation.md", artifactsMD);
    console.log("Saved artifact.");
}

runSimulation();
