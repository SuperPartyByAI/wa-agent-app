-- Phase 3: WhatsApp Media Support Architecture

ALTER TABLE messages 
ADD COLUMN IF NOT EXISTS message_type text DEFAULT 'text',
ADD COLUMN IF NOT EXISTS media_url text,
ADD COLUMN IF NOT EXISTS mime_type text,
ADD COLUMN IF NOT EXISTS file_name text,
ADD COLUMN IF NOT EXISTS file_size bigint,
ADD COLUMN IF NOT EXISTS duration_seconds integer,
ADD COLUMN IF NOT EXISTS latitude numeric,
ADD COLUMN IF NOT EXISTS longitude numeric;

-- Informational: The 'whatsapp_media' Supabase Storage Bucket was automatically created via Node.js backend.
