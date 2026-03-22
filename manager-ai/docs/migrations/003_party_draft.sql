-- Migration: 003_party_draft.sql
-- Description: Creates the core operational table for Phase 3 (Party Builder / Event Dossier)
-- This table replaces isolated event plan records with a comprehensive, master document 
-- representing the complete state of a potential booking/party.

CREATE TABLE public.ai_party_drafts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID NOT NULL UNIQUE REFERENCES public.conversations(id) ON DELETE CASCADE,
    client_id UUID REFERENCES public.clients(id) ON DELETE SET NULL,
    
    -- Status Indicators
    status_dosar VARCHAR(50) DEFAULT 'draft', -- draft, ofertare, precontract, rezervat, anulat
    stare_lead VARCHAR(100), -- synced from ai_lead_runtime_states
    
    -- Core Service Data
    serviciu_principal VARCHAR(100),
    servicii_active JSONB DEFAULT '[]'::jsonb, -- Array of strings e.g. ["animatie", "vata_de_zahar"]
    pachet_selectat VARCHAR(255),
    
    -- Sub-document blocks mapped directly to the Phase 3 JSON architectural spec
    date_generale JSONB DEFAULT '{}'::jsonb,
    detalii_servicii JSONB DEFAULT '{}'::jsonb,
    facturare JSONB DEFAULT '{}'::jsonb,
    comercial JSONB DEFAULT '{}'::jsonb,
    operational JSONB DEFAULT '{}'::jsonb,
    
    istoric_note JSONB DEFAULT '[]'::jsonb, -- Array of timeline events/notes
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for searching drafts by status or lead state
CREATE INDEX idx_ai_party_drafts_status ON public.ai_party_drafts(status_dosar);
CREATE INDEX idx_ai_party_drafts_stare_lead ON public.ai_party_drafts(stare_lead);
CREATE INDEX idx_ai_party_drafts_client ON public.ai_party_drafts(client_id);

-- Auto-update updated_at timestamp trigger
CREATE OR REPLACE FUNCTION update_ai_party_drafts_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER ai_party_drafts_updated_at_trigger
BEFORE UPDATE ON public.ai_party_drafts
FOR EACH ROW
EXECUTE FUNCTION update_ai_party_drafts_updated_at();

-- Record initial audit log for this migration
COMMENT ON TABLE public.ai_party_drafts IS 'Phase 3 Autonomous Agent: Central Event Dossier / Party Builder Storage';
