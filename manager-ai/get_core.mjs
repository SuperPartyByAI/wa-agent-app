import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '../.env' }); // load from wa-agent-app directly

const mainSupa = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const vtxSupa = createClient(process.env.VERTEX_SUPABASE_URL || process.env.SUPABASE_URL, process.env.VERTEX_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
    // get brands
    const { data: sessions } = await mainSupa.from('whatsapp_sessions').select('brand_key').eq('status', 'CONNECTED');
    const brands = [...new Set((sessions||[]).map(s => s.brand_key).filter(Boolean))];
    console.log("=== BRANDS ===");
    console.log(brands.join(", "));

    // get global prices
    const { data: sources } = await vtxSupa.from('vertex_sources').select('*').eq('brand_key', 'GLOBAL').eq('category', 'servicii');
    console.log("\n=== PRETURI GLOBALE ===");
    if(sources && sources.length > 0) console.log(sources[0].content);
}
run();
