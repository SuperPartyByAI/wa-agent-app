-- Migration: 004_party_service_details.sql
-- Description: Extends the schema to handle service-specific details and history 
-- for the Party Draft (Event Dossier) based on Phase 3 business logic.

-- Create table to log the incremental evolution of the party drafts
CREATE TABLE public.ai_party_draft_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    party_id UUID NOT NULL REFERENCES public.ai_party_drafts(id) ON DELETE CASCADE,
    conversation_id UUID NOT NULL,
    action_type VARCHAR(100) NOT NULL, -- 'created', 'updated_general', 'updated_service', 'quoted', 'escalated'
    previous_state JSONB,
    new_state JSONB,
    actor VARCHAR(100) DEFAULT 'ai_agent',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_ai_party_draft_history_party ON public.ai_party_draft_history(party_id);
CREATE INDEX idx_ai_party_draft_history_conv ON public.ai_party_draft_history(conversation_id);

COMMENT ON TABLE public.ai_party_draft_history IS 'Phase 3 Autonomous Agent: Incremental audit log for Party Builder drafts';
