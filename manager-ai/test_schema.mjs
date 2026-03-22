import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
    const { data, error } = await supabase.from('ai_lead_runtime_states').select('*').limit(1);
    if (error) console.error("Error:", error);
    else if (data && data.length > 0) console.log("Columns:", Object.keys(data[0]));
    else console.log("No data returned, cannot infer columns from empty rest response easily. Trying meta schema query...");
}
run();
