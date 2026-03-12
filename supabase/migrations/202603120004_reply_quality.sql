-- Add reply quality columns to ai_reply_decisions
ALTER TABLE ai_reply_decisions ADD COLUMN IF NOT EXISTS reply_quality_score INTEGER;
ALTER TABLE ai_reply_decisions ADD COLUMN IF NOT EXISTS reply_quality_label TEXT;
ALTER TABLE ai_reply_decisions ADD COLUMN IF NOT EXISTS reply_quality_flags TEXT[];
ALTER TABLE ai_reply_decisions ADD COLUMN IF NOT EXISTS reply_style TEXT;
ALTER TABLE ai_reply_decisions ADD COLUMN IF NOT EXISTS composer_used BOOLEAN DEFAULT FALSE;
