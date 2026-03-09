-- Migration: Brand Aliasing & Client Anonymization
-- Date: 2026-03-09

-- 1. Add required schema fields
ALTER TABLE clients 
ADD COLUMN IF NOT EXISTS public_alias TEXT,
ADD COLUMN IF NOT EXISTS internal_client_code TEXT,
ADD COLUMN IF NOT EXISTS brand_key TEXT,
ADD COLUMN IF NOT EXISTS alias_index INTEGER;

-- 2. Create the sequence generator function
-- This function uses advisory locks to guarantee atomic, concurrency-safe alias increments
CREATE OR REPLACE FUNCTION get_next_brand_alias_index(p_brand_key TEXT)
RETURNS INTEGER AS $$
DECLARE
    next_index INTEGER;
    lock_key BIGINT;
BEGIN
    -- Generate a unique bigint lock key from the brand string
    lock_key := ('x' || substr(md5(p_brand_key), 1, 16))::bit(64)::bigint;
    
    -- Acquire exclusive transaction-level lock for this specific brand
    PERFORM pg_advisory_xact_lock(lock_key);
    
    -- Calculate next safe index
    SELECT COALESCE(MAX(alias_index), 0) + 1 INTO next_index
    FROM clients
    WHERE brand_key = p_brand_key;
    
    RETURN next_index;
END;
$$ LANGUAGE plpgsql;
