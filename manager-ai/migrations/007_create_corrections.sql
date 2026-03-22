-- Migration: 007_create_corrections
-- Ticket: stabilizare/antigravity - Corrections Pipeline
-- Stores human corrections to AI decisions for training loop

CREATE TABLE IF NOT EXISTS public.corrections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trace_id TEXT NOT NULL,
    request JSONB NOT NULL,
    request_redacted JSONB NOT NULL,
    original_decision JSONB NOT NULL,
    corrected_decision JSONB NOT NULL,
    annotator_id TEXT,
    approved BOOLEAN DEFAULT false,
    approved_by TEXT,
    approved_at TIMESTAMPTZ,
    tags TEXT[],
    policy_version TEXT,
    model_version TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_corrections_trace ON corrections(trace_id);
CREATE INDEX IF NOT EXISTS idx_corrections_approved ON corrections(approved);
CREATE INDEX IF NOT EXISTS idx_corrections_created ON corrections(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_corrections_policy ON corrections(policy_version);

-- RLS: append + restricted update
ALTER TABLE corrections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_insert_corrections" ON corrections
    FOR INSERT TO service_role WITH CHECK (true);

CREATE POLICY "service_select_corrections" ON corrections
    FOR SELECT TO service_role USING (true);

CREATE POLICY "service_update_corrections" ON corrections
    FOR UPDATE TO service_role USING (true);

-- No DELETE policy = effectively immutable once written
COMMENT ON TABLE corrections IS 'Human corrections to AI decisions — training loop pipeline';
