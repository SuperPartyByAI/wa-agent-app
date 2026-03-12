require('dotenv').config();
const { processConversation } = require('./manager-ai-worker.mjs'); // Ensure extension is handled or written purely explicitly

async function rawDebug() {
    console.log("=== RAW WORKER DEBUG ===");
    // Need DB conversation to execute
    const { createClient } = require('@supabase/supabase-js');
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY);
    
    const { data: conv } = await supabase.from('conversations').select('id').eq('channel', 'whatsapp').order('created_at', { ascending: false }).limit(1).single();
    if (conv) {
        console.log(`Executing worker on conv: ${conv.id}`);
        try {
            // Need to dynamically import ES module from CommonJS test script
            const worker = await import('./manager-ai-worker.mjs');
            await worker.processConversation(conv.id, "DEBUG_MSG_123");
        } catch(e) {
            console.error("FATAL CRASH:", e);
        }
    }
}
rawDebug();
