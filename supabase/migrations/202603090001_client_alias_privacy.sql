-- Migration: Zero-Trust Multi-Tenant Client Aliasing
-- This migration hard-couples deterministic identity sequences explicitly mapped against Active Sessions avoiding Organic Number leakage into the UI

-- 1. WhatsApp Session Core Extensions
ALTER TABLE whatsapp_sessions 
ADD COLUMN IF NOT EXISTS brand_key TEXT,
ADD COLUMN IF NOT EXISTS alias_prefix TEXT;

-- 2. Client Identity Obfuscator Abstractions
ALTER TABLE clients
ADD COLUMN IF NOT EXISTS public_alias TEXT,
ADD COLUMN IF NOT EXISTS internal_client_code TEXT,
ADD COLUMN IF NOT EXISTS alias_index INTEGER,
ADD COLUMN IF NOT EXISTS brand_key TEXT;

-- 3. Atomic State Lock Sequences (Zero-Trust Counter Partitioning)
CREATE TABLE IF NOT EXISTS brand_alias_counters (
    brand_key TEXT PRIMARY KEY,
    current_index INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now())
);

-- 4. PostgreSQL Atomic Allocator
-- Exclusively locks the parent sequence record per physical transaction loop
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
    internal_code := 'CL-' || substr(md5(random()::text), 1, 6);
END;
$$ LANGUAGE plpgsql;

-- 5. Collision Avoidance Unique Architectures
CREATE UNIQUE INDEX IF NOT EXISTS idx_clients_brand_alias_index ON clients (brand_key, alias_index) WHERE brand_key IS NOT NULL AND alias_index IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_clients_brand_public_alias ON clients (brand_key, public_alias) WHERE brand_key IS NOT NULL AND public_alias IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_clients_brand_phone ON clients (brand_key, phone) WHERE brand_key IS NOT NULL AND phone IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_clients_brand_wa_identifier ON clients (brand_key, wa_identifier) WHERE brand_key IS NOT NULL AND wa_identifier IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_clients_internal_code ON clients (internal_client_code) WHERE internal_client_code IS NOT NULL;
