import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function clean() {
  console.log("Fetching test clients...");
  
  // My test number
  const { data: clients1, error: err1 } = await supabase.from('clients').select('id, real_phone_e164').like('real_phone_e164', '%407000%');
  
  // Old dummy seed numbers
  const { data: clients2, error: err2 } = await supabase.from('clients').select('id, real_phone_e164').like('real_phone_e164', '%407999%');
  
  const allTests = [...(clients1 || []), ...(clients2 || [])];
  console.log(`Found ${allTests.length} test clients.`);
  
  if (allTests.length > 0) {
    const ids = allTests.map(c => c.id);
    console.log(`Deleting ${ids.length} test clients...`);
    
    // We do chunks of 100 to avoid request URL too long errors
    for (let i = 0; i < ids.length; i += 100) {
       const chunk = ids.slice(i, i + 100);
       const { error: delErr } = await supabase.from('clients').delete().in('id', chunk);
       if (delErr) {
           console.error("Error deleting chunk:", delErr);
       } else {
           console.log(`Deleted chunk ${i} to ${i + chunk.length}`);
       }
    }
    console.log("Cleanup complete!");
  }
}

clean();
