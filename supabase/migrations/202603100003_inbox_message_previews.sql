-- Migration: Inbox Conversation Summaries View
-- Provides a highly optimized flat output integrating Client identity and the absolute latest Message payload for Android UI rendering.

CREATE OR REPLACE VIEW v_inbox_summaries AS
SELECT 
    c.id AS conversation_id,
    c.status AS conversation_status,
    c.updated_at AS conversation_updated_at,
    c.client_id,
    c.session_id,
    cl.full_name,
    cl.avatar_url,
    cl.public_alias,
    cl.internal_client_code,
    m.content AS last_message_content,
    m.created_at AS last_message_at,
    m.from_me AS last_message_from_me
FROM conversations c
LEFT JOIN clients cl ON c.client_id = cl.id
LEFT JOIN LATERAL (
    SELECT content, created_at, from_me 
    FROM messages 
    WHERE conversation_id = c.id 
    ORDER BY created_at DESC 
    LIMIT 1
) m ON true;

-- Grant access to the authenticated and anon roles for Supabase UI consumption
GRANT SELECT ON v_inbox_summaries TO anon, authenticated;
