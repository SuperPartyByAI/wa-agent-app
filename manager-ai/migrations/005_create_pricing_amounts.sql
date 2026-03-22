-- Migration: 005_create_pricing_amounts
-- Ticket: stabilizare/antigravity - Pricing & Commercial Rules
-- Stores pricing amounts with approval workflow and effective dates

CREATE TABLE IF NOT EXISTS public.pricing_amounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    service_id TEXT NOT NULL,
    amount NUMERIC(18, 4) NOT NULL,
    currency TEXT NOT NULL DEFAULT 'RON',
    duration_hours NUMERIC(4, 1),
    effective_from TIMESTAMPTZ DEFAULT now(),
    effective_until TIMESTAMPTZ,
    created_by TEXT,
    approved_by TEXT,
    approved_at TIMESTAMPTZ,
    status TEXT DEFAULT 'draft',
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pricing_service ON pricing_amounts(service_id);
CREATE INDEX IF NOT EXISTS idx_pricing_status ON pricing_amounts(status);
CREATE INDEX IF NOT EXISTS idx_pricing_effective ON pricing_amounts(effective_from, effective_until);

COMMENT ON TABLE pricing_amounts IS 'Service pricing with approval workflow';
