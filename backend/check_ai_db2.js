require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function checkDb() {
    console.log("=== Checking Manager AI Tables Exact Match ===");
    const tablesToCheck = [
        'ai_conversation_state', 
        'ai_client_memory', 
        'ai_event_drafts', 
        'ai_operator_prompts', 
        'ai_ui_schemas',
        'ai_extractions',
        'ai_actions',
        'events',
        'tasks'
    ];
    
    for (const table of tablesToCheck) {
        const { data, error } = await supabase.from(table).select('*').limit(1);
        if (error) {
            console.log(`[Missing] ${table}: ${error.message}`);
        } else {
            console.log(`[EXISTS] ${table}`);
        }
    }
}
checkDb();
