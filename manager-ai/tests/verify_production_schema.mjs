import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env' }); // Run from manager-ai/

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error("Missing Supabase credentials in .env");
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function verifySchema() {
    console.log("Verifying ai_event_plans schema for Migration 017 fields...");
    
    // We can check if the columns exist by trying to select them. 
    // If they don't exist, Supabase will return a specific PostgREST error.
    const { data, error } = await supabase
        .from('ai_event_plans')
        .select(`
            children_count_estimate,
            payment_method_preference,
            invoice_requested,
            advance_status,
            advance_amount,
            hidden_from_active_ui,
            exclude_from_payroll,
            readiness_for_recommendation
        `)
        .limit(1);

    if (error) {
        if (error.code === 'PGRST200') {
            console.error("❌ Migration 017 missing! Columns not found in ai_event_plans.");
        } else {
            console.error("Database error occurred while checking schema:", error.message);
        }
        process.exit(1);
    } else {
        console.log("✅ Migration 017 is LIVE in Production! All business-real fields found.");
        process.exit(0);
    }
}

verifySchema();
