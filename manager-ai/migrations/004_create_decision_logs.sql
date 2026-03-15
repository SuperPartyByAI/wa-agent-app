-- Migration: 004_create_decision_logs
-- Ticket: stabilizare/antigravity - Decision Logging
-- Append-only table for AI decision audit trail with PII redaction

CREATE TABLE IF NOT EXISTS public.decision_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trace_id TEXT NOT NULL,
    request JSONB,
    request_redacted JSONB,
    decision JSONB,
    policy_version TEXT,
    runtime_zone TEXT DEFAULT 'production',
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_decision_trace ON decision_logs(trace_id);
CREATE INDEX IF NOT EXISTS idx_decision_zone ON decision_logs(runtime_zone);
CREATE INDEX IF NOT EXISTS idx_decision_created ON decision_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_decision_policy ON decision_logs(policy_version);

-- RLS: append-only (no UPDATE or DELETE via API)
ALTER TABLE decision_logs ENABLE ROW LEVEL SECURITY;

-- Service role can insert
CREATE POLICY "service_insert_decision_logs" ON decision_logs
    FOR INSERT TO service_role WITH CHECK (true);

-- Service role can read
CREATE POLICY "service_select_decision_logs" ON decision_logs
    FOR SELECT TO service_role USING (true);

-- No update/delete policies = effectively append-only
COMMENT ON TABLE decision_logs IS 'Append-only AI decision audit trail with PII redaction';
