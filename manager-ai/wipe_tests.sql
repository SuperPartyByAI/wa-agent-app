DO $$ 
DECLARE
    r RECORD;
BEGIN
    FOR r IN 
        SELECT id FROM clients WHERE real_phone_e164 LIKE '%407000%' OR real_phone_e164 LIKE '%407999%'
    LOOP
        -- Delete dependent ai_reply_decisions
        DELETE FROM ai_reply_decisions WHERE conversation_id IN (SELECT id FROM conversations WHERE client_id = r.id);
        
        -- Delete dependent messages
        DELETE FROM messages WHERE conversation_id IN (SELECT id FROM conversations WHERE client_id = r.id);
        
        -- Delete dependent party_drafts
        DELETE FROM party_drafts WHERE client_id = r.id;
        
        -- Delete dependent conversations
        DELETE FROM conversations WHERE client_id = r.id;
        
        -- Delete dependent notebook entries
        DELETE FROM ai_client_notebooks WHERE client_id = r.id;
        
        -- Finally delete the client
        DELETE FROM clients WHERE id = r.id;
    END LOOP;
END $$;
