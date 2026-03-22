import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

// Attempt to call RPC fallback or flush API schema cache 
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
    console.log("Forcing a new Insert to bypass schema cache if PostgREST respects writes...");
    const { data, error } = await supabase.from('ai_lead_runtime_states').upsert({
         conversation_id: 'cache-buster-id-1234',
         lead_state: 'lead_nou',
         followup_status: 'none' // This ensures that the insert will try to hit the new column
    });
    console.log("Insert result:", error ? error.message : "Success");
    
    // Validate schema awareness again:
    const { data: q } = await supabase.from('ai_lead_runtime_states').select('followup_status').limit(1);
    console.log("Query 'followup_status' directly:", q !== null ? "Found Data" : "Not Found Data");
}
run();
