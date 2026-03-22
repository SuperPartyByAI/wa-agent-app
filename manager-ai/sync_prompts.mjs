import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ path: '../backend/.env' });

const mainDb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const vtxDb = createClient('https://yvfhqadfmjgbzetanfxs.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl2ZmhxYWRmbWpnYnpldGFuZnhzIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MzY2ODg2MywiZXhwIjoyMDg5MjQ0ODYzfQ.b99azJ4MhjLD7c7MXBdABhCIKVp3JWFSyrNSdpE5hZk');

async function sync() {
    console.log("Reading from system_prompts in main DB...");
    const { data: prompts, error: pErr } = await mainDb.from('system_prompts').select('*');
    if (pErr) console.error("Error reading prompts:", pErr);
    
    // We want to find the big ones:
    const sysPrompt = prompts?.find(p => p.prompt_key === 'GLOBAL_SYSTEM_PROMPT');
    if (sysPrompt) {
        console.log("Found system prompt. Upserting into vertex_config...");
        await vtxDb.from('vertex_config').upsert({ config_key: 'system_prompt', config_value: sysPrompt.prompt_text, brand_key: 'GLOBAL' }, { onConflict: 'config_key,brand_key' });
    } else {
        console.log("SYS_PROMPT NOT FOUND IN mainDb.system_prompts!");
    }
    
    console.log("Reading ai_roles for catalog...");
    const { data: roles, error: rErr } = await mainDb.from('ai_roles').select('*');
    if (rErr) console.error("Error roles:", rErr);
    if (roles && roles.length > 0) {
        // Build catalog mapping array format for Vertex constraints
        const catalog = roles.map(r => ({
            role_title: r.role_title,
            description: r.description,
            required_details: r.properties_schema ? Object.keys(r.properties_schema) : []
        }));
        
        await vtxDb.from('vertex_config').upsert({ config_key: 'catalog_servicii', config_value: JSON.stringify(catalog), brand_key: 'GLOBAL' }, { onConflict: 'config_key,brand_key' });
        console.log("Upserted catalog of", catalog.length, "roles.");
    }
    
    process.exit(0);
}
sync();
