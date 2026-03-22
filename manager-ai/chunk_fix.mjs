import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '/Users/universparty/wa-web-launcher/wa-agent-app/backend/.env' });
const s = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
    console.log("Fetching all convs...");
    const { data: convs } = await s.from('conversations').select('id');
    console.log(`Working on ${convs.length} items...`);
    
    let updated = 0;
    
    // Process in batches of 40
    for (let i = 0; i < convs.length; i += 40) {
        const batch = convs.slice(i, i + 40);
        await Promise.all(batch.map(async (c) => {
            try {
                const { data: msgs } = await s.from('messages')
                    .select('created_at')
                    .eq('conversation_id', c.id)
                    .order('created_at', { ascending: false })
                    .limit(1);
                    
                if (msgs && msgs.length > 0) {
                    await s.from('conversations').update({ last_message_at: msgs[0].created_at }).eq('id', c.id);
                    updated++;
                } else {
                    await s.from('conversations').update({ last_message_at: '2000-01-01T00:00:00Z' }).eq('id', c.id);
                }
            } catch(e) {}
        }));
        console.log(`Processed batch ${i} to ${i + 40}`);
    }
    console.log(`[SUCCESS] Mass Update Finished! Updated ${updated} true timestamps.`);
}
run();
