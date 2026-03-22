import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.VERTEX_SUPABASE_URL || process.env.SUPABASE_URL, process.env.VERTEX_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
    const { data: sources, error } = await supabase.from('vertex_sources').select('*');
    if (error) console.error("Error sources:", error);
    
    console.log("=== TOATE SURSELE ===");
    (sources || []).forEach(s => console.log(`[${s.brand_key}] [${s.category}] ${s.title}\n${s.content}\n`));

    const { data: brands, error: bErr } = await supabase.from('ai_brand_aliases').select('*');
    if (bErr) console.error("Error brands:", bErr);
    
    console.log("=== BRAND ALIASES ===");
    (brands || []).forEach(b => console.log(b.brand_key));
}
run();
