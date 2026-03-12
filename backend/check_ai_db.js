require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function checkDb() {
    console.log("=== Checking AI Tables ===");
    const tablesToCheck = ['ai_settings', 'ai_intents', 'ai_processing_logs', 'supabase_migrations'];
    
    for (const table of tablesToCheck) {
        const { data, error } = await supabase.from(table).select('*').limit(1);
        if (error) {
            console.log(`Table ${table} check error: ${error.message} (Likely does not exist)`);
        } else {
            console.log(`Table ${table} EXISTS`);
        }
    }
    
    console.log("\n=== Checking 'messages' AI columns ===");
    const { data: msgData, error: msgError } = await supabase.from('messages').select('ai_intent, ai_confidence, ai_handled').limit(1);
    if (msgError) {
        console.log(`Columns missing or error: ${msgError.message}`);
    } else {
        console.log(`AI columns in 'messages' EXIST`);
    }
}
checkDb();
