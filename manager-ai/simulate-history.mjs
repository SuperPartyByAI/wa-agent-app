import { createClient } from '@supabase/supabase-js';
import { processConversation } from './manager-ai-worker.mjs';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
    console.log("Fetching top 3 most recent conversations...");
    const { data: convs, error } = await supabase
        .from('conversations')
        .select('id, client_id')
        .order('updated_at', { ascending: false })
        .limit(3);

    if (error) {
        console.error(error);
        return;
    }

    console.log(`Found ${convs.length} conversations to simulate.`);
    
    for (const conv of convs) {
        console.log(`\n\n=== Simulating client_id: ${conv.client_id} (ID: ${conv.id}) ===`);
        try {
            await processConversation(conv.id);
        } catch (e) {
            console.error(`Failed simulating ${conv.client_id}:`, e.message);
        }
    }
    
    console.log("\n[SUCCESS] Historical simulation completed.");
}

run();
