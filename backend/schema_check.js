require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  const { data: cols, error } = await supabase.from('information_schema.columns')
    .select('table_name, column_name, data_type')
    .in('table_name', ['events', 'tasks', 'ai_actions']);
    
  if (error) {
    console.error("Data fetch error:", error);
    
    // Fallback: RPC schema
    const { data: cols2, error: err2 } = await supabase.rpc('get_schema_info');
    console.log("RPC Error:", err2);
    return;
  }
  
  const formatted = {};
  for(let c of cols) {
      if(!formatted[c.table_name]) formatted[c.table_name] = [];
      formatted[c.table_name].push(`${c.column_name} (${c.data_type})`);
  }
  console.log(JSON.stringify(formatted, null, 2));
}
run();
