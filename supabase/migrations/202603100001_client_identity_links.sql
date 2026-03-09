-- Migration: Normalized 1-to-Many Client Identity Links (Zero-Trust Identity Graph)
-- Extracts 'phone' and 'wa_identifier' from the `clients` table and normalizes them into dynamically scalable bindings.

-- 1. Create the robust Identity Link bindings table
CREATE TABLE IF NOT EXISTS client_identity_links (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    brand_key TEXT NOT NULL,
    identifier_type TEXT NOT NULL, -- e.g., 'msisdn', 'lid', 'jid'
    identifier_value TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    
    -- Absolute guarantee that no Single Physical Identifier maps to >1 Client per Brand natively
    UNIQUE (brand_key, identifier_value)
);

-- Optimize routing lookups for the newly decoupled tables
CREATE INDEX IF NOT EXISTS idx_client_links_lookup ON client_identity_links (brand_key, identifier_value);
CREATE INDEX IF NOT EXISTS idx_client_links_parent ON client_identity_links (client_id);

-- 2. Backfill existing legacy identifiers from `clients` to `client_identity_links` safely
DO $$
BEGIN
    -- Extract Phones
    INSERT INTO client_identity_links (client_id, brand_key, identifier_type, identifier_value, created_at)
    SELECT id, brand_key, 'msisdn', phone, created_at
    FROM clients
    WHERE phone IS NOT NULL
    ON CONFLICT (brand_key, identifier_value) DO NOTHING;

    -- Extract WA Identifiers (LID / JID)
    INSERT INTO client_identity_links (client_id, brand_key, identifier_type, identifier_value, created_at)
    SELECT id, brand_key, 
           CASE WHEN wa_identifier LIKE '%@lid' THEN 'lid' ELSE 'jid' END, 
           wa_identifier, created_at
    FROM clients
    WHERE wa_identifier IS NOT NULL
    ON CONFLICT (brand_key, identifier_value) DO NOTHING;
END $$;

-- 3. Eliminate physical identifier columns from `clients` to enforce Normalized Linking strictly
ALTER TABLE clients DROP COLUMN IF EXISTS phone;
ALTER TABLE clients DROP COLUMN IF EXISTS wa_identifier;

-- 4. Rewrite the Safe Creator RPC to embrace normalized Dynamic Linking arrays
DROP FUNCTION IF EXISTS create_client_identity_safe;

CREATE OR REPLACE FUNCTION create_client_identity_safe(
    p_brand_key TEXT,
    p_identifiers JSONB, -- Example: [{"type": "msisdn", "value": "+123"}, {"type": "jid", "value": "123@s.whatsapp.net"}]
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
    -- 1. Extract values to generate a symmetric sorted hash for transaction-level Parallelism Locking
    FOR v_identifier IN SELECT * FROM jsonb_to_recordset(p_identifiers) AS x(type TEXT, value TEXT) LOOP
        IF v_identifier.value IS NOT NULL AND trim(v_identifier.value) <> '' THEN
            v_identifier_array := array_append(v_identifier_array, v_identifier.value);
        END IF;
    END LOOP;

    -- Sort the array elements identically to ensure lock string symmetry regardless of payload JSON ordering
    SELECT array_to_string(array(SELECT unnest(v_identifier_array) ORDER BY 1), '|') INTO v_lock_hash;

    -- Serialize identical requests natively across parallel NodeJS hooks
    PERFORM pg_advisory_xact_lock(hashtext(p_brand_key || '|' || v_lock_hash));

    -- 2. Check if ANY of the provided identifiers map to an existing client
    SELECT array_agg(DISTINCT l.client_id)
    INTO v_matched_ids
    FROM client_identity_links l
    WHERE l.brand_key = p_brand_key 
      AND l.identifier_value = ANY(v_identifier_array);

    -- 3. Evaluate Match States
    IF v_matched_ids IS NOT NULL AND array_length(v_matched_ids, 1) > 0 THEN
        -- Sort explicitly to designate the earliest formed UUID sequentially as the Primary
        -- Aggregate order cannot be natively guaranteed with DISTINCT, so we sort it here.
        SELECT array_agg(sorted_id) INTO v_matched_ids FROM (
            SELECT unnest(v_matched_ids) AS sorted_id ORDER BY sorted_id ASC
        ) s;
        
        v_primary_id := v_matched_ids[1];

        -- A. Auto-Merger for Split-Brain Identity Clones (Fragmented Arrivals)
        IF array_length(v_matched_ids, 1) > 1 THEN
            FOR i IN 2..array_length(v_matched_ids, 1) LOOP
                v_clone_id := v_matched_ids[i];
                
                -- Re-route historic conversation relationships natively
                UPDATE conversations SET client_id = v_primary_id WHERE client_id = v_clone_id;
                -- Re-route existing identity links natively
                UPDATE client_identity_links SET client_id = v_primary_id WHERE client_id = v_clone_id;
                
                -- Purge the structural shell of the clone client securely
                DELETE FROM clients WHERE id = v_clone_id;
            END LOOP;
        END IF;

        -- B. Bind all incoming novel identifiers onto the Primary ID symmetrically
        -- This ensures if a new identifier was introduced in this webhook payload, it permanently bridges
        FOR v_identifier IN SELECT * FROM jsonb_to_recordset(p_identifiers) AS x(type TEXT, value TEXT) LOOP
            IF v_identifier.value IS NOT NULL AND trim(v_identifier.value) <> '' THEN
                BEGIN
                    INSERT INTO client_identity_links (client_id, brand_key, identifier_type, identifier_value)
                    VALUES (v_primary_id, p_brand_key, v_identifier.type, v_identifier.value)
                    ON CONFLICT DO NOTHING; -- Silently skips if the value is already bound exactly to someone
                EXCEPTION WHEN unique_violation THEN NULL; -- Graceful fallback for extreme DB parallel edge cases
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
            VALUES (v_alias, p_source, p_brand_key, v_alias, v_internal_code, v_idx)
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
            -- Locks dynamically serialize overlapping Identity Links above.
            -- This block triggers ONLY if internal_client_code randomly collided on creation!
        END;
    END LOOP;
END;
$$ LANGUAGE plpgsql;
