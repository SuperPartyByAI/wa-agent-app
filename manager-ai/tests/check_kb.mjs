import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } from '../src/config/env.mjs';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function run() {
    const { data } = await supabase.from('ai_knowledge_base').select('metadata').eq('knowledge_key', 'animator_packages').single();
    if (data?.metadata?.packages) {
        data.metadata.packages.forEach(p => {
             console.log(`Code: ${p.package_code} | Title: ${p.title} | Price: ${p.price}`);
        });
    } else {
        console.log("No packages found");
    }
}
run();
