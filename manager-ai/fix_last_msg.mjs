import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '/Users/universparty/wa-web-launcher/wa-agent-app/backend/.env' });

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function run() {
    console.log("[FIX] Transferul orarului istoric in coloana publica 'last_message_at' pe cele 860 de dosare...");
    const { data: convs } = await supabase.from('conversations').select('id');
    let updated = 0;
    
    // Chunking to prevent any rate limit
    for (let i = 0; i < convs.length; i++) {
        const c = convs[i];
        
        // Preluam cel mai nou mesaj pur, neafectat de trigger
        const { data: msgs } = await supabase.from('messages')
            .select('created_at')
            .eq('conversation_id', c.id)
            .order('created_at', { ascending: false })
            .limit(1);
            
        if (msgs && msgs.length > 0) {
            const realDate = msgs[0].created_at;
            // Injectam pe canalul neprotejat!
            await supabase.from('conversations').update({ last_message_at: realDate }).eq('id', c.id);
            updated++;
            if (updated % 50 === 0) console.log(`[FIX] Migrat la ${updated} conversatii...`);
        } else {
            // Conversatii fara msg
            await supabase.from('conversations').update({ last_message_at: '2000-01-01T00:00:00Z' }).eq('id', c.id);
        }
    }
    console.log(`\n[SUCCESS] Victorie! Orarul a fost rescris in coloana last_message_at pentru ${updated} conversatii!`);
}
run();
