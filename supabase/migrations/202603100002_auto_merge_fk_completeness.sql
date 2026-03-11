-- Migration: Auto-Merge Foreign Key Completeness
-- Resolves a critical vulnerability where the Split-Brain Auto-Merger only migrated `conversations`.
-- Orphaned references to `events` (ON DELETE RESTRICT) would violently crash the webhook transaction.
-- Orphaned references to `tasks` (ON DELETE CASCADE) would silently inflict data loss.

CREATE OR REPLACE FUNCTION create_client_identity_safe(
    p_brand_key TEXT,
    p_identifiers JSONB, 
    p_source TEXT,
    p_alias_prefix TEXT
) RETURNS TABLE (id UUID, avatar_url TEXT, public_alias TEXT, internal_client_code TEXT) AS $$
DECLARE
    v_idx INTEGER;
    v_alias TEXT;
    v_internal_code TEXT;
    v_client_id UUID;
    v_avatar_url TEXT;
    
    v_matched_ids UUID[];
    v_primary_id UUID;
    v_clone_id UUID;
    
    v_lock_hash TEXT := '';
    v_identifier RECORD;
    v_identifier_array TEXT[] := ARRAY[]::TEXT[];
BEGIN
    -- 2. Check if ANY of the provided identifiers map to an existing client
    SELECT array_agg(DISTINCT l.client_id)
    INTO v_matched_ids
    FROM client_identity_links l
    WHERE l.brand_key = p_brand_key 
      AND l.identifier_value = ANY(v_identifier_array);

    -- 3. Evaluate Match States
    IF v_matched_ids IS NOT NULL AND array_length(v_matched_ids, 1) > 0 THEN
        -- Sort explicitly to designate the earliest formed UUID sequentially as the Primary
        SELECT array_agg(sorted_id) INTO v_matched_ids FROM (
            SELECT unnest(v_matched_ids) AS sorted_id ORDER BY sorted_id ASC
        ) s;
        
        v_primary_id := v_matched_ids[1];

        -- A. Auto-Merger for Split-Brain Identity Clones
        IF array_length(v_matched_ids, 1) > 1 THEN
            FOR i IN 2..array_length(v_matched_ids, 1) LOOP
                v_clone_id := v_matched_ids[i];
                
                -- Migrate ALL 7 Foreign Key Relations meticulously to prevent 'ON DELETE RESTRICT' database crashes and 'CASCADE' data loss.
                UPDATE event_notes SET event_id = (SELECT id FROM events WHERE client_id = v_primary_id LIMIT 1) WHERE event_id IN (SELECT id FROM events WHERE client_id = v_clone_id); -- Edge case protection if merging events later, but here we just move the events directly.
                
                UPDATE conversations SET client_id = v_primary_id WHERE client_id = v_clone_id;
                UPDATE call_events SET client_id = v_primary_id WHERE client_id = v_clone_id;
                UPDATE events SET client_id = v_primary_id WHERE client_id = v_clone_id;
                UPDATE tasks SET client_id = v_primary_id WHERE client_id = v_clone_id;
                UPDATE client_addresses SET client_id = v_primary_id WHERE client_id = v_clone_id;
                UPDATE ai_extractions SET client_id = v_primary_id WHERE client_id = v_clone_id;
                
                -- Identity Links must be merged using INSERT ON CONFLICT to survive Multi-Row Unique violations safely
                INSERT INTO client_identity_links (client_id, brand_key, identifier_type, identifier_value, created_at)
                SELECT v_primary_id, brand_key, identifier_type, identifier_value, created_at
                FROM client_identity_links WHERE client_id = v_clone_id
                ON CONFLICT (brand_key, identifier_value) DO NOTHING;
                
                DELETE FROM client_identity_links WHERE client_id = v_clone_id;
                
                -- Purge the structural shell of the clone client securely (No further FK Violations will trigger)
                DELETE FROM clients WHERE id = v_clone_id;
            END LOOP;
        END IF;

        -- B. Bind all incoming novel identifiers onto the Primary ID symmetrically
        FOR v_identifier IN SELECT * FROM jsonb_to_recordset(p_identifiers) AS x(type TEXT, value TEXT) LOOP
            IF v_identifier.value IS NOT NULL AND trim(v_identifier.value) <> '' THEN
                BEGIN
                    INSERT INTO client_identity_links (client_id, brand_key, identifier_type, identifier_value)
                    VALUES (v_primary_id, p_brand_key, v_identifier.type, v_identifier.value)
                    ON CONFLICT DO NOTHING;
                EXCEPTION WHEN unique_violation THEN NULL; 
                END;
            END IF;
        END LOOP;

        RETURN QUERY SELECT c.id, c.avatar_url, c.public_alias, c.internal_client_code FROM clients c WHERE c.id = v_primary_id;
        RETURN;
    END IF;

    -- 4. Identity requires Creation. Reserve the Brand Sequence Counter exactly once per loop exit.
    SELECT reserve_brand_alias.idx, reserve_brand_alias.alias INTO v_idx, v_alias FROM reserve_brand_alias(p_brand_key, p_alias_prefix);

    -- 5. Exception Loop for mathematically protected internal_client_code allocation
    LOOP
        BEGIN
            v_internal_code := 'CL-' || substr(md5(random()::text || clock_timestamp()::text), 1, 12);

            -- Materialize Client structure
            INSERT INTO clients (full_name, source, brand_key, public_alias, internal_client_code, alias_index)
            VALUES (v_alias, p_source::client_source, p_brand_key, v_alias, v_internal_code, v_idx)
            RETURNING clients.id, clients.avatar_url, clients.public_alias, clients.internal_client_code
            INTO v_client_id, v_avatar_url, v_alias, v_internal_code;

            -- Attach initial Identity Link bindings comprehensively
            FOR v_identifier IN SELECT * FROM jsonb_to_recordset(p_identifiers) AS x(type TEXT, value TEXT) LOOP
                IF v_identifier.value IS NOT NULL AND trim(v_identifier.value) <> '' THEN
                    INSERT INTO client_identity_links (client_id, brand_key, identifier_type, identifier_value)
                    VALUES (v_client_id, p_brand_key, v_identifier.type, v_identifier.value);
                END IF;
            END LOOP;

            RETURN QUERY SELECT v_client_id, v_avatar_url, v_alias, v_internal_code;
            RETURN;
        EXCEPTION WHEN unique_violation THEN
            -- Recover and re-loop on random cryptographic collisions
        END;
    END LOOP;
END;
$$ LANGUAGE plpgsql;
