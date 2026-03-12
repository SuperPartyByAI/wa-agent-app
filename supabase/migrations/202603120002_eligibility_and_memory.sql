-- Add eligibility audit columns to ai_reply_decisions
-- These track WHY each auto-reply was allowed or blocked

ALTER TABLE ai_reply_decisions
ADD COLUMN IF NOT EXISTS eligibility_status TEXT DEFAULT 'unknown',
ADD COLUMN IF NOT EXISTS eligibility_reason TEXT DEFAULT 'not_evaluated';

-- Add current_stage to ai_conversation_state (some conversations need this)
ALTER TABLE ai_conversation_state
ADD COLUMN IF NOT EXISTS current_stage TEXT;

-- Index for eligibility queries
CREATE INDEX IF NOT EXISTS idx_ai_reply_decisions_eligibility
ON ai_reply_decisions(eligibility_status, eligibility_reason);

-- Comment explaining values
COMMENT ON COLUMN ai_reply_decisions.eligibility_status IS 'eligible | blocked';
COMMENT ON COLUMN ai_reply_decisions.eligibility_reason IS 'allowed | global_switch_off | blocked_below_cutoff | blocked_stage_* | blocked_manual_legacy | blocked_existing_draft | blocked_by_decision | blocked_needs_review | blocked_low_confidence | blocked_escalation';
