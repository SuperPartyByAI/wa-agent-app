import dotenv from 'dotenv';
dotenv.config();

const GEMINI_API_KEY = process.env.VERTEX_AI_API_KEY || process.env.GEMINI_API_KEY;

async function embedText(model) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:embedContent?key=${GEMINI_API_KEY}`;
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            model: `models/${model}`,
            content: { parts: [{ text: "Hello world" }] },
            taskType: 'SEMANTIC_SIMILARITY',
            outputDimensionality: 768
        })
    });
    if (!response.ok) {
        console.log(model, await response.text());
        return null;
    }
    const data = await response.json();
    console.log(model, "Success!", data.embedding?.values?.length, "dimensions");
}

await embedText('gemini-embedding-001');
