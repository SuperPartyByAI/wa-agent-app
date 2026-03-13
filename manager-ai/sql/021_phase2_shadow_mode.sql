-- Phase 2: Shadow Mode + Safe Autoreply
-- Adds operator feedback columns to ai_reply_decisions

ALTER TABLE ai_reply_decisions ADD COLUMN IF NOT EXISTS safety_class TEXT;
ALTER TABLE ai_reply_decisions ADD COLUMN IF NOT EXISTS operator_verdict TEXT;
ALTER TABLE ai_reply_decisions ADD COLUMN IF NOT EXISTS operator_edited_reply TEXT;
ALTER TABLE ai_reply_decisions ADD COLUMN IF NOT EXISTS operator_feedback_reason TEXT;
ALTER TABLE ai_reply_decisions ADD COLUMN IF NOT EXISTS operator_feedback_at TIMESTAMPTZ;
ALTER TABLE ai_reply_decisions ADD COLUMN IF NOT EXISTS tool_action_suggested TEXT;
ALTER TABLE ai_reply_decisions ADD COLUMN IF NOT EXISTS tool_action_executed TEXT;
ALTER TABLE ai_reply_decisions ADD COLUMN IF NOT EXISTS safety_class_reasons JSONB DEFAULT '[]'::jsonb;
ALTER TABLE ai_reply_decisions ADD COLUMN IF NOT EXISTS memory_context_used JSONB DEFAULT '{}'::jsonb;
ALTER TABLE ai_reply_decisions ADD COLUMN IF NOT EXISTS operational_mode TEXT DEFAULT 'legacy';

-- Index for operator review queue
CREATE INDEX IF NOT EXISTS idx_reply_decisions_safety_class ON ai_reply_decisions (safety_class) WHERE safety_class IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_reply_decisions_operator_verdict ON ai_reply_decisions (operator_verdict) WHERE operator_verdict IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_reply_decisions_operational_mode ON ai_reply_decisions (operational_mode) WHERE operational_mode != 'legacy';

COMMENT ON COLUMN ai_reply_decisions.safety_class IS 'safe_autoreply_allowed | needs_operator_review | blocked_autoreply';
COMMENT ON COLUMN ai_reply_decisions.operator_verdict IS 'approved_as_is | approved_with_edits | rejected | dangerous | misunderstood_client | wrong_tool | should_have_clarified | unnecessary_question | wrong_memory_usage';
COMMENT ON COLUMN ai_reply_decisions.operational_mode IS 'legacy | shadow_mode | safe_autoreply_mode | full_autoreply_mode';
