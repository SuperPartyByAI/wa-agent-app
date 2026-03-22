import dotenv from 'dotenv';
dotenv.config();

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const MODEL = 'gemini-2.5-flash-lite';

async function testModel() {
    console.log(`🧪 Testând Modelul Universal: ${MODEL}...`);
    
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${GEMINI_API_KEY}`;
    const body = {
        contents: [{ role: 'user', parts: [{ text: 'Explică în 2 propoziții de ce ești cel mai bun model pentru Superparty.' }] }]
    };

    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        
        console.log(`📡 Status: ${res.status} ${res.statusText}`);
        const data = await res.json();
        
        if (data.error) {
            console.error('❌ Eroare:', data.error.message);
            return;
        }

        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
        console.log('\n🤖 Răspuns Gemini 2.5 Flash-Lite:');
        console.log('-----------------------------------');
        console.log(text);
        console.log('-----------------------------------');
        console.log('\n✅ Demonstrație Reușită: Modelul este activ și universal.');
    } catch (e) {
        console.error('❌ Eroare Rețea:', e.message);
    }
}

testModel();
