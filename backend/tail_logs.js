const { spawn } = require('child_process');

console.log("=== WAITING FOR REALTIME EPIC PAYLOAD ===");

// We spawn a live tail of the PM2 logs that will never exit until we manually kill it
const tail = spawn('pm2', ['logs', 'wa-api', '--lines', '5']);

tail.stdout.on('data', (data) => {
    const output = data.toString();
    // Only print lines that are actually part of the inbound message payload or identity resolution
    if (output.includes('messages.upsert') || output.includes('resolveClientIdentity') || output.includes('Brand Cache') || output.includes('SESSION_B5743B')) {
        console.log(output);
    }
});

tail.stderr.on('data', (data) => {
    // disregard PM2 standard err spam
});
