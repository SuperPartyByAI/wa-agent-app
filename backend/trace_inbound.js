require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY);
const fs = require('fs');
const { execSync } = require('child_process');

async function traceInbound() {
    console.log("=== TRACING NEW CLIENT INBOUND MESSAGES ===");
    
    // 1. Check recent conversations created today (last 2 hours)
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    
    // Get ALL messages from the last 2 hours
    const { data: recentMsgs, error: errMsgs } = await supabase
        .from('messages')
        .select(`
            id, whatsapp_message_id, conversation_id, direction, content, created_at,
            conversations!inner(
                id, client_id, status, session_id,
                clients!inner(
                    id, full_name, brand_key, public_alias
                )
            )
        `)
        .gte('created_at', twoHoursAgo)
        .order('created_at', { ascending: false })
        .limit(50);
        
    if (errMsgs) {
        console.error("Failed to query recent messages:", errMsgs);
    } else {
        console.log(`Found ${recentMsgs.length} messages in DB from the last 2 hours.`);
        const inboundMsgs = recentMsgs.filter(m => m.direction === 'inbound');
        console.log(`  - ${inboundMsgs.length} are inbound.`);
        if (inboundMsgs.length > 0) {
            console.log("  Sample of successful inbound in DB:");
            console.log("  ID:", inboundMsgs[0].whatsapp_message_id);
            console.log("  Alias:", inboundMsgs[0].conversations.clients.public_alias);
            console.log("  Time:", inboundMsgs[0].created_at);
        }
    }

    // 2. Extract PM2 logs for exact ingest failures
    try {
        console.log("\nExtracting PM2 wa-api errors/drops from the last hour...");
        // Look for errors or specific drops in the log
        const logContent = execSync('grep -i -C 2 "error\\|drop\\|fail\\|timeout\\|upsert\\|inbound" ~/.pm2/logs/wa-api-out.log | tail -n 100').toString();
        
        const lines = logContent.split('\n').filter(Boolean);
        let foundErrors = 0;
        
        lines.forEach(line => {
            if (line.toLowerCase().includes('error') || line.toLowerCase().includes('fail') || line.toLowerCase().includes('timeout') || line.toLowerCase().includes('drop')) {
                console.log(`[PM2 ERROR] ${line.substring(0, 150)}`);
                foundErrors++;
            }
        });
        
        if (foundErrors === 0) {
            console.log("No obvious errors found in the recent PM2 log tail for wa-api.");
        }
    } catch (e) {
        console.error("Could not read PM2 logs:", e.message);
    }
}

traceInbound();
