-- Migration: 012_ai_training_messages.sql
-- Description: Creates the shadow conversation table for AI parallel training

CREATE TABLE IF NOT EXISTS public.ai_training_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
    sender_type TEXT NOT NULL CHECK (sender_type IN ('client', 'ai')),
    content TEXT NOT NULL,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_ai_training_messages_conversation_id ON public.ai_training_messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_ai_training_messages_created_at ON public.ai_training_messages(created_at DESC);

-- Security: Row Level Security Rules
ALTER TABLE public.ai_training_messages ENABLE ROW LEVEL SECURITY;

-- Allow read/write for service_role and authenticated queries
CREATE POLICY "Allow all access for authenticated and service_role" 
ON public.ai_training_messages 
FOR ALL 
USING (true) 
WITH CHECK (true);
