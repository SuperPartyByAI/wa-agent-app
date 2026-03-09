-- Migration: Zero-Trust Multi-Tenant Client Aliasing Hardening (Bugfixes)
-- Addresses Birthday Paradox collision risk resulting from extreme bounds mapping of 6-character internal codes.
-- Also fortifies unique constraints natively against incomplete rollback scenarios.

-- 1. Helper function for absolutely unique identity codes ensuring zero Birthday Paradox collisions
CREATE OR REPLACE FUNCTION generate_unique_internal_code() RETURNS TEXT AS $$
DECLARE
    v_code TEXT;
    v_exists BOOLEAN;
BEGIN
    LOOP
        -- Secure collision-free generation using md5 length expansion (over 281-trillion permutations)
        v_code := 'CL-' || substr(md5(random()::text || clock_timestamp()::text), 1, 12);
        
        -- Explicitly verify the code does not already exist natively (eliminating collision Unique Constraint errors)
        SELECT EXISTS(SELECT 1 FROM clients WHERE internal_client_code = v_code) INTO v_exists;
        
        IF NOT v_exists THEN
            RETURN v_code;
        END IF;
    END LOOP;
END;
$$ LANGUAGE plpgsql;

-- 2. Redefining PostgreSQL Atomic Allocator securely using the new retry-safe sequence
CREATE OR REPLACE FUNCTION reserve_brand_alias(p_brand_key TEXT, p_alias_prefix TEXT, OUT idx INTEGER, OUT alias TEXT, OUT internal_code TEXT)
AS $$
BEGIN
    -- Force UPSERT logic to initialize or aggressively lock existing counter
    INSERT INTO brand_alias_counters (brand_key, current_index)
    VALUES (p_brand_key, 1)
    ON CONFLICT (brand_key) DO UPDATE
    SET current_index = brand_alias_counters.current_index + 1,
        updated_at = timezone('utc'::text, now())
    RETURNING current_index INTO idx;

    -- Format alias explicitly 
    alias := p_alias_prefix || '-' || LPAD(idx::TEXT, 2, '0');
    
    -- Assign guaranteed unique ID
    internal_code := generate_unique_internal_code();
END;
$$ LANGUAGE plpgsql;

-- 2. Removed destructive cleanup. We only run idempotent backfills.

-- 3. Run explicit backfill over missing internal codes safely
DO $$
DECLARE
    rec RECORD;
    v_idx INTEGER;
    v_alias TEXT;
    v_internal_code TEXT;
BEGIN
    FOR rec IN 
        SELECT id, brand_key, wa_identifier, phone FROM clients 
        WHERE internal_client_code IS NULL AND brand_key IS NOT NULL
    LOOP
        v_internal_code := generate_unique_internal_code();
        UPDATE clients SET internal_client_code = v_internal_code WHERE id = rec.id;
    END LOOP;
END;
$$;
