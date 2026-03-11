require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY);

async function injectDebug() {
  console.log("=== INJECTING PG DEBUG INTO create_client_identity_safe ===");
  
  const sql = `
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
    v_loop_count INTEGER := 0;
BEGIN
    FOR v_identifier IN SELECT * FROM jsonb_to_recordset(p_identifiers) AS x(type TEXT, value TEXT) LOOP
        IF v_identifier.value IS NOT NULL AND trim(v_identifier.value) <> '' THEN
            v_identifier_array := array_append(v_identifier_array, v_identifier.value);
        END IF;
    END LOOP;

    SELECT array_to_string(array(SELECT unnest(v_identifier_array) ORDER BY 1), '|') INTO v_lock_hash;
    PERFORM pg_advisory_xact_lock(hashtext(p_brand_key || '|' || v_lock_hash));

    SELECT array_agg(DISTINCT l.client_id) INTO v_matched_ids
    FROM client_identity_links l
    WHERE l.brand_key = p_brand_key AND l.identifier_value = ANY(v_identifier_array);

    IF v_matched_ids IS NOT NULL AND array_length(v_matched_ids, 1) > 0 THEN
        -- Standard Match Logic (Omitted auto-merge for this debug scope)
        v_primary_id := v_matched_ids[1];
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

    -- Creation Phase
    SELECT reserve_brand_alias.idx, reserve_brand_alias.alias INTO v_idx, v_alias FROM reserve_brand_alias(p_brand_key, p_alias_prefix);

    LOOP
        v_loop_count := v_loop_count + 1;
        IF v_loop_count > 5 THEN
           RAISE EXCEPTION 'Hard Loop Abort: Too many unique_violations. Last error state dumped above.';
        END IF;

        BEGIN
            v_internal_code := 'CL-' || substr(md5(random()::text || clock_timestamp()::text), 1, 12);

            INSERT INTO clients (full_name, source, brand_key, public_alias, internal_client_code, alias_index)
            VALUES (v_alias, p_source::client_source, p_brand_key, v_alias, v_internal_code, v_idx)
            RETURNING clients.id, clients.avatar_url, clients.public_alias, clients.internal_client_code
            INTO v_client_id, v_avatar_url, v_alias, v_internal_code;

            FOR v_identifier IN SELECT * FROM jsonb_to_recordset(p_identifiers) AS x(type TEXT, value TEXT) LOOP
                IF v_identifier.value IS NOT NULL AND trim(v_identifier.value) <> '' THEN
                    INSERT INTO client_identity_links (client_id, brand_key, identifier_type, identifier_value)
                    VALUES (v_client_id, p_brand_key, v_identifier.type, v_identifier.value);
                END IF;
            END LOOP;

            RETURN QUERY SELECT v_client_id, v_avatar_url, v_alias, v_internal_code;
            RETURN;
            
        EXCEPTION WHEN unique_violation THEN
            -- Expose exactly what broke instead of looping infinitely
            RAISE NOTICE 'UNIQUE_VIOLATION captured on Loop %: % - %', v_loop_count, SQLERRM, SQLSTATE;
        END;
    END LOOP;
END;
$$ LANGUAGE plpgsql;
  `;
  
  // We can't easily execute raw DDL text directly through the standard REST client sometimes
  // So we use a generic SQL runner approach if a procedure exists, or we use the REST api.
  // Actually, easiest way is to run a postgres query directly or just use Supabase.
  try {
     const { data, error } = await supabase.rpc('execute_sql', { sql_string: sql });
     if (error) {
         console.error("Failed to inject SQL via REST. Error:", JSON.stringify(error));
     } else {
         console.log("SQL Injected Successfully.");
     }
  } catch(e) { console.error(e) }
}

injectDebug();
