import dotenv from 'dotenv'; 
dotenv.config();
import { createClient } from '@supabase/supabase-js';

const db = createClient(process.env.VERTEX_SUPABASE_URL, process.env.VERTEX_SUPABASE_SERVICE_ROLE_KEY);
const mainDb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
    console.log("=== REPAIRING ORPHANED VERTEX SESSIONS ===");
    
    // Extragem sesiunile care au UUID în loc de E.164 (lungime > 20)
    const { data: sessions, error } = await db.from('vertex_sessions').select('id, phone_e164');
    
    if (error) console.error("Vertex query error:", error);
    if (!sessions) {
        console.error("Null sessions array returned, exiting.");
        return process.exit(0);
    }
    
    const orphaned = sessions.filter(s => s.phone_e164.length > 20); 
    
    for (const session of orphaned) {
        const { data: conv } = await mainDb.from('conversations').select('client_id').eq('id', session.phone_e164).maybeSingle();
        if (conv?.client_id) {
            const { data: client } = await mainDb.from('clients').select('real_phone_e164').eq('id', conv.client_id).maybeSingle();
            if (client?.real_phone_e164) {
                console.log(`Mapping ${session.phone_e164} -> ${client.real_phone_e164}`);
                
                // Evităm duplicate keys ștergând sesiunea goală creată recent (dacă există)
                const {data: existing} = await db.from('vertex_sessions').select('id').eq('phone_e164', client.real_phone_e164).maybeSingle();
                if (existing) {
                    await db.from('vertex_sessions').delete().eq('id', existing.id); 
                }
                
                // Lipim uuid-ul originar la telefon
                await db.from('vertex_sessions').update({ phone_e164: client.real_phone_e164 }).eq('id', session.id);
            }
        }
    }
    console.log("=== DONE ===");
    process.exit(0);
}
run();
