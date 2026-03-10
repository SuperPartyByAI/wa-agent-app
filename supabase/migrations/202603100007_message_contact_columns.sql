-- Fix for Blank Conversation Screen: Missing schema columns for Contact VCard support

ALTER TABLE messages 
ADD COLUMN IF NOT EXISTS contact_name text,
ADD COLUMN IF NOT EXISTS contact_vcard text;
