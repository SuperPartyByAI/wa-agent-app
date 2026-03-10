-- Migration: Omnichannel Route Isolation
-- Prevents conversations originating from different firm numbers (brands) from merging into a single active thread.
-- Enhances Inbox View to explicitly attach the originating Session Label.

-- 1. Enforce 1 Active WhatsApp Conversation per Route limit natively in Postgres
CREATE UNIQUE INDEX IF NOT EXISTS unique_active_conv_per_route 
ON conversations (client_id, channel, session_id) 
WHERE status = 'open';

-- 2. Enhance v_inbox_summaries to project the Session Label to the UI
CREATE OR REPLACE VIEW v_inbox_summaries AS
SELECT 
    c.id AS conversation_id,
    c.status AS conversation_status,
    c.updated_at AS conversation_updated_at,
    c.client_id,
    c.session_id,
    ws.label AS session_label,
    cl.full_name,
    cl.avatar_url,
    cl.public_alias,
    cl.internal_client_code,
    m.content AS last_message_content,
    m.created_at AS last_message_at,
    m.from_me AS last_message_from_me
FROM conversations c
LEFT JOIN clients cl ON c.client_id = cl.id
LEFT JOIN whatsapp_sessions ws ON c.session_id = ws.session_key
LEFT JOIN LATERAL (
    SELECT content, created_at, from_me 
    FROM messages 
    WHERE conversation_id = c.id 
    ORDER BY created_at DESC 
    LIMIT 1
) m ON true;

GRANT SELECT ON v_inbox_summaries TO anon, authenticated;
