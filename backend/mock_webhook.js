// Fire a real mock webhook to simulate Baileys inbound
const http = require('http');

const payload = {
    "event": "messages.upsert",
    "sessionId": "wa_epic",
    "data": {
        "messages": [
            {
                "key": {
                    "remoteJid": "40799988877@s.whatsapp.net",
                    "fromMe": false,
                    "id": "MOCK_MSG_" + Date.now()
                },
                "message": {
                    "conversation": "Hello! I am a brand new client."
                },
                "messageTimestamp": Math.floor(Date.now() / 1000)
            }
        ],
        "type": "notify"
    }
};

const options = {
    hostname: '127.0.0.1',
    port: 3000,
    path: '/webhook/whts-up',
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'x-baileys-secret': 'YOUR_WEBHOOK_SECRET_MOCKED'
    }
};

const req = http.request(options, (res) => {
    console.log(`STATUS: ${res.statusCode}`);
    res.setEncoding('utf8');
    res.on('data', (chunk) => {
        console.log(`BODY: ${chunk}`);
    });
});

req.on('error', (e) => {
    console.error(`problem with request: ${e.message}`);
});

req.write(JSON.stringify(payload));
req.end();
