import { createClient } from '@supabase/supabase-js';
const supabase = createClient('https://jrfhprnuxxfwkwjwdsez.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpyZmhwcm51eHhmd2t3andkc2V6Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MzAwMjIzMiwiZXhwIjoyMDg4NTc4MjMyfQ.0SoUFRVD3PyQg45QKvBM0yDoGJMNrsV-1KyGX0TA4yI');
async function run() {
  const { data, error } = await supabase.from('ai_event_plans').select('*').limit(1);
  console.log(Object.keys(data[0]));
}
run();
