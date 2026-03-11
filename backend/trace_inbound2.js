require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY);
const { execSync } = require('child_process');

async function traceInbound() {
    console.log("=== TRACING NEW CLIENT INBOUND MESSAGES ===");
    
    // 1. Check PM2 logs for new client messages
    try {
        console.log("Extracting PM2 wa-api 'messages.upsert' and 'resolveClientIdentity' logs from the last 2 hours...");
        
        // Find recent notify/append logs
        const loggrep = execSync('grep -i "messageupsert\\|messages.upsert\\|resolveclientidentity\\|synchistoricalmessagetosupabase\\|new client" ~/.pm2/logs/wa-api-out.log | tail -n 150').toString();
        
        const lines = loggrep.split('\n').filter(Boolean);
        let inboundFound = 0;
        let resolveFails = 0;
        let insertFails = 0;
        
        console.log(`\nFound ${lines.length} relevant processing traces in logs.`);
        
        lines.forEach(line => {
            // Only print highly relevant ones
            if (line.toLowerCase().includes('inbound') || 
                line.toLowerCase().includes('fail') || 
                line.toLowerCase().includes('error') ||
                line.toLowerCase().includes('creating new client')) {
                console.log(`  -> ${line.substring(0, 180)}`);
            }
        });
        
    } catch (e) {
        console.error("Could not read PM2 logs:", e.message);
    }
}

traceInbound();
