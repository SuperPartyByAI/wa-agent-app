import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ path: '../backend/.env' });

const s = createClient(
    'https://yvfhqadfmjgbzetanfxs.supabase.co',
    process.env.VERTEX_SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl2ZmhxYWRmbWpnYnpldGFuZnhzIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MzY2ODg2MywiZXhwIjoyMDg5MjQ0ODYzfQ.b99azJ4MhjLD7c7MXBdABhCIKVp3JWFSyrNSdpE5hZk'
);

async function run() {
    const { data, error } = await s.from('vertex_config').select('config_key, config_value').eq('brand_key', 'GLOBAL');
    if (error) {
        console.error("Eroare db:", error);
    } else {
        const p = data.find(r => r.config_key==='system_prompt');
        console.log("System Prompt:\n", p ? p.config_value.substring(0, 300) + '...' : "MISSING");
        console.log("Are CONSTRANGERI_DE_COLECTAT:", p?.config_value?.includes('CONSTRANGERI_DE_COLECTAT'));
        
        const cat = data.find(r => r.config_key === 'catalog_servicii');
        console.log("Catalog:", !!cat);
        console.log("Tool nota:", data.find(r=>r.config_key==='tool_desc_noteaza_petrecere')?.config_value.substring(0, 100));
    }
    process.exit(0);
}
run();
