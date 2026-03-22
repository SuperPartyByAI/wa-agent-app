import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { join } from 'path';

dotenv.config({ path: '/Users/universparty/wa-web-launcher/wa-agent-app/backend/.env' });

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function run() {
    console.log("Fetching conversations...");
    const { data: convs, error: convErr } = await supabase.from('conversations').select('id');
    if (convErr) { console.error("Error fetching convs", convErr); return; }
    console.log(`Found ${convs.length} conversations to migrate...`);
    
    let updatedCount = 0;
    
    for (let c of convs) {
        try {
            const { data: msgs } = await supabase.from('messages')
                .select('created_at')
                .eq('conversation_id', c.id)
                .order('created_at', { ascending: false })
                .limit(1);
                
            if (msgs && msgs.length > 0) {
                const { error: updErr } = await supabase.from('conversations').update({ last_message_at: msgs[0].created_at }).eq('id', c.id);
                if (updErr) console.error(`Err updating ${c.id}:`, updErr);
                else {
                    updatedCount++;
                    if (updatedCount % 100 === 0) console.log(`Finished ${updatedCount} / ${convs.length}...`);
                }
            } else {
                const { error: updErr } = await supabase.from('conversations').update({ last_message_at: '2000-01-01T00:00:00Z' }).eq('id', c.id);
                if (updErr) console.error(`Err updating dummy ${c.id}:`, updErr);
            }
        } catch (e) {
            console.error("Inner loop err for ", c.id, ":", e);
        }
    }
    console.log(`\nDONE! Finalized migration. Successfully updated true message time for ${updatedCount} conversations.`);
}
run().catch(console.error);
