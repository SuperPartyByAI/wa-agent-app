-- Migration: Fix UNKNOWN-branded orphan clients
-- Root cause: Batch history sync on 2026-03-10 created clients with brand_key=UNKNOWN
-- before the session was labeled. Same LIDs now exist under both UNKNOWN and SUPERPARTY,
-- causing duplicate clients and split conversations (Superparty-Uxx in Inbox).
--
-- Strategy:
--   1. For each UNKNOWN client, find canonical match via shared LID in SUPERPARTY
--   2. Migrate all FK relations to canonical client
--   3. Merge identity links
--   4. Delete orphaned shell
--   5. For unmatched UNKNOWN clients, rebase to correct brand

DO $$
DECLARE
    v_orphan RECORD;
    v_canonical_id UUID;
    v_session_brand TEXT;
    v_session_prefix TEXT;
    v_new_idx INTEGER;
    v_new_alias TEXT;
    v_merged INTEGER := 0;
    v_rebased INTEGER := 0;
BEGIN
    FOR v_orphan IN
        SELECT c.id, c.public_alias, c.brand_key
        FROM clients c
        WHERE c.brand_key = 'UNKNOWN'
        ORDER BY c.created_at ASC
    LOOP
        -- Try to find canonical client via shared LID
        SELECT DISTINCT c2.id INTO v_canonical_id
        FROM client_identity_links l1
        JOIN client_identity_links l2 ON l2.identifier_value = l1.identifier_value
            AND l2.brand_key <> 'UNKNOWN'
        JOIN clients c2 ON c2.id = l2.client_id
        WHERE l1.client_id = v_orphan.id
          AND l1.brand_key = 'UNKNOWN'
        LIMIT 1;

        IF v_canonical_id IS NOT NULL AND v_canonical_id <> v_orphan.id THEN
            -- MERGE: Migrate all FK relations to canonical
            UPDATE conversations SET client_id = v_canonical_id WHERE client_id = v_orphan.id;
            UPDATE events SET client_id = v_canonical_id WHERE client_id = v_orphan.id;
            UPDATE tasks SET client_id = v_canonical_id WHERE client_id = v_orphan.id;
            UPDATE call_events SET client_id = v_canonical_id WHERE client_id = v_orphan.id;
            UPDATE client_addresses SET client_id = v_canonical_id WHERE client_id = v_orphan.id;
            UPDATE ai_extractions SET client_id = v_canonical_id WHERE client_id = v_orphan.id;
            
            -- event_notes reference events, not clients directly — safe via CASCADE
            -- ai_event_drafts and ai_reply_decisions reference conversations — unchanged
            
            -- Merge identity links (skip duplicates)
            INSERT INTO client_identity_links (client_id, brand_key, identifier_type, identifier_value)
            SELECT v_canonical_id, 
                   CASE WHEN brand_key = 'UNKNOWN' THEN (SELECT brand_key FROM clients WHERE id = v_canonical_id) ELSE brand_key END,
                   identifier_type, identifier_value
            FROM client_identity_links WHERE client_id = v_orphan.id
            ON CONFLICT (brand_key, identifier_value) DO NOTHING;
            
            -- Delete orphan links and client shell
            DELETE FROM client_identity_links WHERE client_id = v_orphan.id;
            DELETE FROM clients WHERE id = v_orphan.id;
            
            v_merged := v_merged + 1;
            RAISE NOTICE 'MERGED % -> canonical %', v_orphan.public_alias, v_canonical_id;
        ELSE
            -- REBASE: No canonical match — find correct brand from conversation session
            SELECT ws.brand_key, ws.alias_prefix INTO v_session_brand, v_session_prefix
            FROM conversations conv
            JOIN whatsapp_sessions ws ON ws.session_key = conv.session_id
            WHERE conv.client_id = v_orphan.id
              AND ws.brand_key IS NOT NULL
            LIMIT 1;

            IF v_session_brand IS NOT NULL THEN
                -- Get next sequential alias index for this brand
                SELECT reserve_brand_alias.idx, reserve_brand_alias.alias 
                INTO v_new_idx, v_new_alias 
                FROM reserve_brand_alias(v_session_brand, v_session_prefix);

                UPDATE clients SET 
                    brand_key = v_session_brand,
                    public_alias = v_new_alias,
                    full_name = v_new_alias,
                    alias_index = v_new_idx
                WHERE id = v_orphan.id;
                
                UPDATE client_identity_links SET brand_key = v_session_brand
                WHERE client_id = v_orphan.id AND brand_key = 'UNKNOWN';

                v_rebased := v_rebased + 1;
                RAISE NOTICE 'REBASED % -> % (brand %)', v_orphan.public_alias, v_new_alias, v_session_brand;
            END IF;
        END IF;
    END LOOP;

    RAISE NOTICE 'DONE: Merged=%, Rebased=%', v_merged, v_rebased;
END;
$$;
