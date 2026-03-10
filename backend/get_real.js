const fetch = require('node-fetch');

async function getRealPhone() {
    const targetId = '01746008-9500-4cad-8ac8-51a0a719e758'; // User Superparty-U11 
    console.log(`Pinging local REST API for client ${targetId}...`);
    try {
        const response = await fetch(`http://localhost:3000/api/clients/${targetId}/real-number`);
        const json = await response.json();
        console.log("Response:", JSON.stringify(json, null, 2));
    } catch (e) {
        console.error("Fetch failed:", e.message);
    }
}

getRealPhone();
