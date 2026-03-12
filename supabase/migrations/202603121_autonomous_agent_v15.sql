-- Autonomous Event Agent V1.5 — Audit fields for progression, autonomy, escalation
-- Adds columns to ai_reply_decisions for full auditability of agent decisions.

ALTER TABLE ai_reply_decisions ADD COLUMN IF NOT EXISTS next_step TEXT;
ALTER TABLE ai_reply_decisions ADD COLUMN IF NOT EXISTS progression_status TEXT;
ALTER TABLE ai_reply_decisions ADD COLUMN IF NOT EXISTS autonomy_level TEXT;
ALTER TABLE ai_reply_decisions ADD COLUMN IF NOT EXISTS escalation_type TEXT;
ALTER TABLE ai_reply_decisions ADD COLUMN IF NOT EXISTS escalation_reason TEXT;
