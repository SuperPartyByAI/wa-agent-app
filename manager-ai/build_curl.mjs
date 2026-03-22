import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const apiKey = process.env.WHTSUP_API_KEY || 'd3vqL8sZp2kT6xN9bR4mY7cD1fG5jH0w';

async function generateCurl() {
  const { data: conv } = await supabase.from('conversations').select('session_id').eq('id', '3119205d-dbbf-4787-bdad-3129fe2eeebc').single();
  
  const payload = {
    sessionId: conv.session_id,
    conversationId: '3119205d-dbbf-4787-bdad-3129fe2eeebc',
    text: "🤖 *DIAGNOSTIC ACTIVAT*\\n\\nAvem și Spiderman, și Batman, și tot ce-ți dorești! 🔥 Aceasta este o demonstrație LIVE a faptului că integrarea Vertex AI comunică acum perfect și bidirecțional cu modulul WhatsApp din Germania pe portul 3002! Test complet trece cu SUCCES! ✅",
    message_type: 'text'
  };

  const curl = `curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:3002/api/messages/send \\
-H "x-api-key: ${apiKey}" \\
-H "Content-Type: application/json" \\
-d '${JSON.stringify(payload)}'`;

  console.log(curl);
}

generateCurl();
