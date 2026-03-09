-- Migration: Zero-Trust PostgREST Field-Level PII Exposure Lockdown
-- Hardens the database against malicious or compromised Android UI tokens attempting to manually SELECT PII identifiers.

-- Ensure missing columns exist before locking their privileges natively.
ALTER TABLE clients ADD COLUMN IF NOT EXISTS avatar_url TEXT;
ALTER TABLE whatsapp_sessions ADD COLUMN IF NOT EXISTS sync_percent INTEGER DEFAULT 0;
ALTER TABLE call_events ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now());

-- 1. Clients Table Lockdown
-- Revoke all generic SELECT grants
REVOKE SELECT ON clients FROM anon, authenticated;

-- Explicitly whitelist ONLY safe fields for public/authenticated consumption
GRANT SELECT (
    id, 
    created_at, 
    updated_at, 
    full_name, 
    source, 
    avatar_url, 
    public_alias, 
    internal_client_code, 
    alias_index, 
    brand_key
) ON clients TO anon, authenticated;

-- Ensure service_role and postgres retain FULL access for backend routing operations
GRANT SELECT ON clients TO service_role, postgres;

-- 2. WhatsApp Sessions Lockdown 
-- Prevents UI from querying the raw 'phone_number' attached to a session
REVOKE SELECT ON whatsapp_sessions FROM anon, authenticated;

-- Whitelist safe fields
GRANT SELECT (
    id,
    session_key,
    created_at,
    updated_at,
    label,
    status,
    sync_percent,
    last_seen_at,
    brand_key,
    alias_prefix
) ON whatsapp_sessions TO anon, authenticated;
GRANT SELECT ON whatsapp_sessions TO service_role, postgres;

-- 3. Call Events Lockdown
-- Prevents UI from querying raw 'from_number' and 'extension' if not strictly routed
REVOKE SELECT ON call_events FROM anon, authenticated;

GRANT SELECT (
    id,
    client_id,
    direction,
    status,
    recording_url,
    duration_seconds,
    started_at,
    ended_at,
    created_at,
    updated_at
) ON call_events TO anon, authenticated;
GRANT SELECT ON call_events TO service_role, postgres;

-- WARNING: The PostgREST cache must be explicitly reloaded to apply column-level mutations immediately.
NOTIFY pgrst, 'reload schema';
