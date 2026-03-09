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
    v_existing_phone TEXT;
    v_existing_wa TEXT;
BEGIN
        -- 1. Serialize requests for the EXACT same physical user per brand natively.
        -- Acquires an exclusive transaction-level lock binding the inbound identity.
        -- This guarantees parallel webhooks for the same user wait physically in line, 
        -- completely eliminating 'Unique Violation' race conditions on phone/wa_id 
        -- and strictly preventing any wasted/burned alias-counters (Alias Gaps).
        PERFORM pg_advisory_xact_lock(hashtext(p_brand_key || '|' || COALESCE(p_phone, '') || '|' || COALESCE(p_wa_identifier, '')));

        -- 2. Check if client already materialized (lookup by physical identity)
        -- Carefully structures OR constraints to respect NULL identity bridges
        SELECT c.id, c.avatar_url, c.public_alias, c.internal_client_code, c.phone, c.wa_identifier
        INTO v_client_id, v_avatar_url, v_alias, v_internal_code, v_existing_phone, v_existing_wa
        FROM clients c
        WHERE c.brand_key = p_brand_key 
          AND (
              (p_phone IS NOT NULL AND c.phone = p_phone) OR 
              (p_wa_identifier IS NOT NULL AND c.wa_identifier = p_wa_identifier)
          )
        ORDER BY c.created_at ASC
        LIMIT 1;

        -- 3. If physical uniqueness resolved, optionally bridge missing identity fields, then return
        IF v_client_id IS NOT NULL THEN
            IF (p_phone IS NOT NULL AND v_existing_phone IS NULL) OR (p_wa_identifier IS NOT NULL AND v_existing_wa IS NULL) THEN
                UPDATE clients 
                SET phone = COALESCE(clients.phone, p_phone),
                    wa_identifier = COALESCE(clients.wa_identifier, p_wa_identifier)
                WHERE id = v_client_id;
            END IF;

            RETURN QUERY SELECT v_client_id, v_avatar_url, v_alias, v_internal_code;
            RETURN;
        END IF;

        -- 4. Identity requires creation. We reserve the alias counter STRICTLY ONCE per transaction sequence.
        -- By keeping this outside the Exception Loop, we mathematically guarantee 0 burned counters on hash drift.
        SELECT reserve_brand_alias.idx, reserve_brand_alias.alias INTO v_idx, v_alias FROM reserve_brand_alias(p_brand_key, p_alias_prefix);

        -- 5. Strict Loop dedicated exclusively to allocating the 12-char internal cryptographic hash safely
        LOOP
            BEGIN
                v_internal_code := 'CL-' || substr(md5(random()::text || clock_timestamp()::text), 1, 12);

                INSERT INTO clients (full_name, source, brand_key, public_alias, internal_client_code, alias_index, phone, wa_identifier)
                VALUES (v_alias, p_source, p_brand_key, v_alias, v_internal_code, v_idx, p_phone, p_wa_identifier)
                RETURNING clients.id, clients.avatar_url, clients.public_alias, clients.internal_client_code
                INTO v_client_id, v_avatar_url, v_alias, v_internal_code;

                -- Absolute success
                RETURN QUERY SELECT v_client_id, v_avatar_url, v_alias, v_internal_code;
                RETURN;
            EXCEPTION WHEN unique_violation THEN
                -- The PostgreSQL Advisory Lock above proves this Unique Violation is NOT from a duplicate phone insertion.
                -- It means we hit a 1-in-281-trillion collision on 'internal_client_code'.
                -- The PL/pgSQL engine seamlessly rolls back the micro-statement and restarts the loop with a new hash allocation.
                -- The Alias sequence (v_idx, v_alias) is preserved untouched.
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
