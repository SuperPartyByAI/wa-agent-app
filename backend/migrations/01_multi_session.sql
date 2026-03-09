-- Migration 01: WhatsApp Multi-Session Architecture Enforcement
-- Purpose: Binds conversations and messages explicitly to their parent WhatsApp node to prevent cross-account outbound leakage.

-- 1. conversations table
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS session_id VARCHAR(255);

-- 2. messages table (for auditing and strict DB isolation)
ALTER TABLE messages ADD COLUMN IF NOT EXISTS session_id VARCHAR(255);

-- 3. whatsapp_sessions (verify schema integrity)
-- Expected to already exist, but ensuring the structure is solid:
CREATE TABLE IF NOT EXISTS public.whatsapp_sessions (
    session_key text NOT NULL,
    status text,
    qr_code text,
    phone_number text,
    last_seen_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT whatsapp_sessions_pkey PRIMARY KEY (session_key)
);
