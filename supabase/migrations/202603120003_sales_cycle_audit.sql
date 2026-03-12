-- Sales cycle audit columns for ai_reply_decisions
-- Tracks cycle reasoning for each decision: cycle_status (eligible/blocked/review)
-- and cycle_reason (closed_cycle_new_event, active_cycle_same_event, etc.)

ALTER TABLE ai_reply_decisions
    ADD COLUMN IF NOT EXISTS cycle_status TEXT DEFAULT 'unknown',
    ADD COLUMN IF NOT EXISTS cycle_reason TEXT;
