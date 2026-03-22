import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
dotenv.config({ path: '/Users/universparty/wa-web-launcher/wa-agent-app/backend/.env' });

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
   console.error("Lipsește cheia Supabase!");
   process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function run() {
    console.log("[FIX] Incepem restaurarea ordinii cronologice a separarilor de conversatii...");

    // 1. Luam toate conversatiile din Supabase
    const { data: convs, error: convErr } = await supabase.from('conversations').select('id, updated_at, client_id');
    if (convErr) {
       console.error("Eroare la conversatii:", convErr);
       return;
    }
    
    console.log(`[FIX] S-au gasit ${convs.length} conversatii totale. Cautam datele reale...`);

    let updated = 0;
    
    // Pentru a fluidiza limitele de REST (Rate-Limit), mergem chunck-uri (concurrency limitat)
    for (let i = 0; i < convs.length; i++) {
        const c = convs[i];
        
        // Cautam cel mai recent mesaj 
        const { data: msgs } = await supabase.from('messages')
            .select('created_at')
            .eq('conversation_id', c.id)
            .order('created_at', { ascending: false })
            .limit(1);
            
        if (msgs && msgs.length > 0) {
            const realDate = msgs[0].created_at;
            const realTime = new Date(realDate).getTime();
            const currTime = c.updated_at ? new Date(c.updated_at).getTime() : 0;
            
            // Defalcam diferenta. Dacă ora asignată pe dosar este radical alta decât ora ultimului test (diferență mai mare de 1 secundă)
            if (Math.abs(realTime - currTime) > 1000) {
                 await supabase.from('conversations').update({ updated_at: realDate }).eq('id', c.id);
                 updated++;
                 if (updated % 50 === 0) console.log(`[FIX] Am reparat ${updated} conversatii...`);
            }
        }
    }

    console.log(`\n[SUCCESS] Re-sortarea a fost efectuată! ${updated} conversatii aveau ordinea alterată.`);
}

run();
