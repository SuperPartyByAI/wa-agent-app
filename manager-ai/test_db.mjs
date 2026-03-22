import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } from './src/config/env.mjs';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function check() {
    const { data, error } = await supabase.from('ai_knowledge_base').select('*').limit(3);
    console.log(JSON.stringify(data[0], null, 2));
}
check();
