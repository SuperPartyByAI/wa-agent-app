import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function testRPC() {
    const { data, error } = await supabase.rpc('exec_sql', { query: 'SELECT 1' });
    console.log("exec_sql Error:", error?.message || error);
    console.log("exec_sql Data:", data);
}
testRPC();
