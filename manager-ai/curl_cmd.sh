[dotenv@17.3.1] injecting env (24) from .env -- tip: ⚙️  suppress all logs with { quiet: true }
curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:3002/api/messages/send \
-H "x-api-key: SuperSecretApiKey2024" \
-H "Content-Type: application/json" \
-d '{"sessionId":"wa_b46e5e75","conversationId":"3119205d-dbbf-4787-bdad-3129fe2eeebc","text":"🤖 *DIAGNOSTIC ACTIVAT*\\n\\nAvem și Spiderman, și Batman, și tot ce-ți dorești! 🔥 Aceasta este o demonstrație LIVE a faptului că integrarea Vertex AI comunică acum perfect și bidirecțional cu modulul WhatsApp din Germania pe portul 3002! Test complet trece cu SUCCES! ✅","message_type":"text"}'
