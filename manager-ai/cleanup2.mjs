import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function clean() {
  // 1. Delete AI Training Messages
  const { data: d1, error: e1 } = await supabase
    .from('ai_training_messages')
    .delete()
    .eq('content', 'Îmi pare rău, am o problemă temporară. Te rog încearcă din nou!');
    
  console.log("Deleted pollution from ai_training_messages:", e1 ? e1.message : 'SUCCESS');

  // 2. Delete corresponding AI Reply Decisions
  const { data: d2, error: e2 } = await supabase
    .from('ai_reply_decisions')
    .delete()
    .eq('suggested_reply', 'Îmi pare rău, am o problemă temporară. Te rog încearcă din nou!');
    
  console.log("Deleted pollution from ai_reply_decisions:", e2 ? e2.message : 'SUCCESS');
}

clean();
