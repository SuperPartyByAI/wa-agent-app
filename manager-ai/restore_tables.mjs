import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

dotenv.config();

const SUPABASE_URL = process.env.VERTEX_SUPABASE_URL;
const SUPABASE_KEY = process.env.VERTEX_SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('Missing VERTEX_SUPABASE_URL or VERTEX_SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function runSQL() {
    try {
        const sqlPath = path.resolve('docs/migrations/011_notebook_storage.sql');
        const sqlContent = fs.readFileSync(sqlPath, 'utf8');
        
        console.log('Executing SQL migration to restore ai_notebook_templates...');
        
        // Use the exec_sql RPC function which is typically enabled on this project
        const { data, error } = await supabase.rpc('exec_sql', { query: sqlContent });
        
        if (error) {
            console.error('RPC exec_sql failed:', error.message);
            process.exit(1);
        } else {
            console.log('Tables successfully created/restored!');
        }
    } catch (e) {
        console.error('Script Error:', e.message);
    }
}

runSQL();
