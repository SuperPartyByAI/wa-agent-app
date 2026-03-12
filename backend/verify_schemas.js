require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function verify() {
    console.log("=== VERIFYING AI AND COLLABORATOR SCHEMAS ===");
    
    let allExist = true;
    let rwSuccess = true;

    const aiTables = [
        'ai_conversation_state',
        'ai_client_memory',
        'ai_event_drafts',
        'ai_operator_prompts',
        'ai_ui_schemas'
    ];

    const collabTables = [
        'collaborator_applications',
        'collaborator_documents',
        'collaborator_ai_reviews',
        'collaborator_admin_reviews',
        'collaborator_audit_events'
    ];

    console.log("\n--- Checking AI Tables ---");
    let aiExist = true;
    for (const t of aiTables) {
        const { error } = await supabase.from(t).select('*').limit(1);
        if (error) {
            console.log(`[!] Missing: ${t} (${error.message})`);
            aiExist = false;
            allExist = false;
        } else {
            console.log(`[OK] Exists: ${t}`);
        }
    }

    console.log("\n--- Checking Collaborator Tables ---");
    let collabExist = true;
    for (const t of collabTables) {
        const { error } = await supabase.from(t).select('*').limit(1);
        if (error) {
            console.log(`[!] Missing: ${t} (${error.message})`);
            collabExist = false;
            allExist = false;
        } else {
            console.log(`[OK] Exists: ${t}`);
        }
    }

    console.log("\n--- Testing R/W Permissions ---");
    // Test AI Write/Read
    try {
        console.log("-> Testing ai_operator_prompts...");
        const { data: insAi, error: errAiIns } = await supabase.from('ai_operator_prompts').insert({ prompt_text: 'TEST_PROMPT' }).select().single();
        if (errAiIns) throw errAiIns;
        
        const { data: selAi, error: errAiSel } = await supabase.from('ai_operator_prompts').select('*').eq('id', insAi.id).single();
        if (errAiSel) throw errAiSel;

        const { error: errAiDel } = await supabase.from('ai_operator_prompts').delete().eq('id', insAi.id);
        if (errAiDel) throw errAiDel;
        
        console.log("[OK] AI R/W Cycle Passed");
    } catch(err) {
        console.error(`[!] AI R/W Failed: ${err.message}`);
        rwSuccess = false;
    }

    // Test Collab Write/Read
    try {
        console.log("-> Testing collaborator_applications...");
        const { data: insCol, error: errColIns } = await supabase.from('collaborator_applications').insert({ declared_email: 'test@test.com' }).select().single();
        if (errColIns) throw errColIns;
        
        const { data: selCol, error: errColSel } = await supabase.from('collaborator_applications').select('*').eq('id', insCol.id).single();
        if (errColSel) throw errColSel;

        const { error: errColDel } = await supabase.from('collaborator_applications').delete().eq('id', insCol.id);
        if (errColDel) throw errColDel;
        
        console.log("[OK] Collab R/W Cycle Passed");
    } catch(err) {
        console.error(`[!] Collab R/W Failed: ${err.message}`);
        rwSuccess = false;
    }

    console.log("\n=== FINAL VERDICT ===");
    console.log(`- ai tables exist live: ${aiExist ? 'da' : 'nu'}`);
    console.log(`- collaborator tables exist live: ${collabExist ? 'da' : 'nu'}`);
    console.log(`- manager-ai can read/write them: ${rwSuccess ? 'da' : 'nu'}`);
}

verify();
