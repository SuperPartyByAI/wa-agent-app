-- Migration 005: Follow-up and Handoff tracking

-- Extension for ai_lead_runtime_states to support autonomous follow-up and operator handoffs
ALTER TABLE ai_lead_runtime_states
ADD COLUMN IF NOT EXISTS followup_status text DEFAULT 'none',
ADD COLUMN IF NOT EXISTS followup_count int DEFAULT 0,
ADD COLUMN IF NOT EXISTS last_followup_sent_at timestamptz,
ADD COLUMN IF NOT EXISTS handoff_to_operator boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS handoff_reason text,
ADD COLUMN IF NOT EXISTS closed_status text DEFAULT 'open',
ADD COLUMN IF NOT EXISTS closed_at timestamptz,
ADD COLUMN IF NOT EXISTS operator_owned_at timestamptz,
ADD COLUMN IF NOT EXISTS operator_id text,
ADD COLUMN IF NOT EXISTS do_not_followup boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS do_not_followup_reason text;

-- Index for searching eligible follow-ups
CREATE INDEX IF NOT EXISTS idx_ai_lead_runtime_states_follow_up 
ON ai_lead_runtime_states(follow_up_due_at, followup_status, closed_status, handoff_to_operator, do_not_followup);
