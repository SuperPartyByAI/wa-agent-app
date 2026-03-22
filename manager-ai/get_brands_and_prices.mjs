import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.VERTEX_SUPABASE_URL || process.env.SUPABASE_URL, process.env.VERTEX_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
    // 1. Get current prices
    const { data: sources, error: sErr } = await supabase.from('vertex_sources')
        .select('*')
        .eq('category', 'servicii')
        .eq('brand_key', 'GLOBAL');
    
    if (sErr) console.error("Error sources:", sErr);
    if (sources && sources.length > 0) {
        console.log("=== PRETURI GLOBALE CURENTE ===");
        console.log(sources[0].content);
        console.log("===============================\n");
    }

    // 2. Get brands
    const { data: configs, error: cErr } = await supabase.from('vertex_config').select('brand_key');
    if (cErr) console.error("Error configs:", cErr);
    
    const brands = [...new Set(configs?.map(c => c.brand_key) || [])].filter(b => b !== 'GLOBAL');
    console.log("=== BRAND-URI ACTIVE (QR-uri) ===");
    console.log(brands.join(', '));
}
run();
