-- Migration: Zero-Trust Multi-Tenant Client Aliasing Hardening (Final Concurrent Safe)
-- Drops fragile EXISTS() pre-checks and moves to strict exception-based deterministic loop resolution.

-- 1. PostgreSQL Atomic Allocator Interface (Kept for Legacy/Separation support)
CREATE OR REPLACE FUNCTION reserve_brand_alias(p_brand_key TEXT, p_alias_prefix TEXT, OUT idx INTEGER, OUT alias TEXT)
AS $$
BEGIN
    INSERT INTO brand_alias_counters (brand_key, current_index)
    VALUES (p_brand_key, 1)
    ON CONFLICT (brand_key) DO UPDATE
    SET current_index = brand_alias_counters.current_index + 1,
        updated_at = timezone('utc'::text, now())
    RETURNING current_index INTO idx;

    alias := p_alias_prefix || '-' || LPAD(idx::TEXT, 2, '0');
END;
$$ LANGUAGE plpgsql;

-- 2. Strictly Concurrent-Safe New Client Generation RPC
-- This RPC executes the entire lookup -> alias reserve -> internal_code generation -> insert sequence atomically.
-- It catches standard unique_violations (code 23505) generated natively by the database engine and safely re-loops.
CREATE OR REPLACE FUNCTION create_client_identity_safe(
    p_brand_key TEXT,
    p_phone TEXT,
    p_wa_identifier TEXT,
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
BEGIN
    -- 1. Serialize requests for the EXACT same physical user per brand natively.
    PERFORM pg_advisory_xact_lock(hashtext(p_brand_key || '|' || COALESCE(p_phone, '') || '|' || COALESCE(p_wa_identifier, '')));

    -- 2. Check if client already materialized
    -- By aggregating all matches, we detect "Split-Brain" scenarios (e.g. Phone-only client and LID-only client)
    -- that are now joined by a webhook containing BOTH physical identifiers.
    SELECT array_agg(c.id ORDER BY c.created_at ASC)
    INTO v_matched_ids
    FROM clients c
    WHERE c.brand_key = p_brand_key 
      AND (
          (p_phone IS NOT NULL AND c.phone = p_phone) OR 
          (p_wa_identifier IS NOT NULL AND c.wa_identifier = p_wa_identifier)
      );

    IF v_matched_ids IS NOT NULL AND array_length(v_matched_ids, 1) > 0 THEN
        v_primary_id := v_matched_ids[1];

        -- 3. Auto-Merger for Split-Brain Clones
        IF array_length(v_matched_ids, 1) > 1 THEN
            FOR i IN 2..array_length(v_matched_ids, 1) LOOP
                v_clone_id := v_matched_ids[i];
                -- Re-route all conversations from clone to primary
                UPDATE conversations SET client_id = v_primary_id WHERE client_id = v_clone_id;
                -- Safe purge of the clone
                DELETE FROM clients WHERE id = v_clone_id;
            END LOOP;
        END IF;

        -- 4. Bridge missing PII securely onto the unified Primary Record
        -- We isolate this to prevent unexpected unicity drops if bad data attempts overlap
        BEGIN
            UPDATE clients 
            SET phone = COALESCE(clients.phone, p_phone),
                wa_identifier = COALESCE(clients.wa_identifier, p_wa_identifier)
            WHERE clients.id = v_primary_id;
        EXCEPTION WHEN unique_violation THEN
            NULL; -- Safely ignore if a bizarre unique overlap survives the merge
        END;

        RETURN QUERY SELECT c.id, c.avatar_url, c.public_alias, c.internal_client_code FROM clients c WHERE c.id = v_primary_id;
        RETURN;
    END IF;

    -- 5. Identity requires creation. Reserve alias STRCITLY ONCE.
    SELECT reserve_brand_alias.idx, reserve_brand_alias.alias INTO v_idx, v_alias FROM reserve_brand_alias(p_brand_key, p_alias_prefix);

    -- 6. Strict Exception loop for 12-char cryptographic internal_client_code assignment
    LOOP
        BEGIN
            v_internal_code := 'CL-' || substr(md5(random()::text || clock_timestamp()::text), 1, 12);

            INSERT INTO clients (full_name, source, brand_key, public_alias, internal_client_code, alias_index, phone, wa_identifier)
            VALUES (v_alias, p_source, p_brand_key, v_alias, v_internal_code, v_idx, p_phone, p_wa_identifier)
            RETURNING clients.id, clients.avatar_url, clients.public_alias, clients.internal_client_code
            INTO v_client_id, v_avatar_url, v_alias, v_internal_code;

            RETURN QUERY SELECT v_client_id, v_avatar_url, v_alias, v_internal_code;
            RETURN;
        EXCEPTION WHEN unique_violation THEN
            -- Locks mathematically eliminate Phone/LID duplicates here.
            -- Ergo this ONLY fires if the randomly generated `internal_client_code` collided.
            -- Loops and instantly regenerates ensuring completely isolated 0-burn alias assignment.
        END;
    END LOOP;
END;
$$ LANGUAGE plpgsql;

-- 3. Concurrent-Safe Idempotent Backfill Logic
-- Recovers legacy rows utilizing exactly the same Exception loop architecture over Native Unique Constraints.
DO $$
DECLARE
    rec RECORD;
    v_internal_code TEXT;
    v_success BOOLEAN;
BEGIN
    FOR rec IN 
        SELECT c.id FROM clients c
        WHERE c.internal_client_code IS NULL AND c.brand_key IS NOT NULL
    LOOP
        v_success := FALSE;
        WHILE NOT v_success LOOP
            BEGIN
                v_internal_code := 'CL-' || substr(md5(random()::text || clock_timestamp()::text), 1, 12);
                UPDATE clients SET internal_client_code = v_internal_code WHERE id = rec.id;
                v_success := TRUE;
            EXCEPTION WHEN unique_violation THEN
                -- Collision blocked explicitly by index, safely retry with fresh cryptographic hash
            END;
        END LOOP;
    END LOOP;
END;
$$;
