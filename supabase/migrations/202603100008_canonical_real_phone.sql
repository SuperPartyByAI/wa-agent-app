-- Migration 202603100008_canonical_real_phone.sql

ALTER TABLE clients
ADD COLUMN IF NOT EXISTS real_phone_e164 VARCHAR(50),
ADD COLUMN IF NOT EXISTS real_phone_source VARCHAR(50),
ADD COLUMN IF NOT EXISTS real_phone_confidence INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS real_phone_updated_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS real_phone_notes TEXT;

-- Create an index to quickly look up clients by their canonical phone number in the future
CREATE INDEX IF NOT EXISTS idx_clients_real_phone ON clients(real_phone_e164);
