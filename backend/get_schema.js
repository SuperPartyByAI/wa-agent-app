require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
async function run() {
  const { data, error } = await supabase.from('conversations').select('*').limit(1);
  console.log("Cols:", data ? Object.keys(data[0] || {}) : "No data", "Error:", error);
}
run();
