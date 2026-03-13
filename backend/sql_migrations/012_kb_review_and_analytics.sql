-- ============================================
-- 012: KB Review + Analytics Hardening
-- ============================================

-- 1. Analytics events table — structured audit trail
CREATE TABLE IF NOT EXISTS ai_analytics_events (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    event_type  text NOT NULL,                 -- kb_match_found, decision_reply_now, etc.
    conversation_id uuid,
    payload     jsonb DEFAULT '{}',            -- event-specific data
    created_at  timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_analytics_type ON ai_analytics_events(event_type);
CREATE INDEX IF NOT EXISTS idx_analytics_conv ON ai_analytics_events(conversation_id);
CREATE INDEX IF NOT EXISTS idx_analytics_time ON ai_analytics_events(created_at);
CREATE INDEX IF NOT EXISTS idx_analytics_type_time ON ai_analytics_events(event_type, created_at);

-- 2. Add reviewed_at to learned corrections
ALTER TABLE ai_learned_corrections
    ADD COLUMN IF NOT EXISTS reviewed_at timestamptz;

-- 3. No-match log for identifying KB gaps
CREATE TABLE IF NOT EXISTS ai_kb_misses (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    conversation_id uuid,
    client_message  text NOT NULL,
    best_score      float DEFAULT 0,
    detected_services text[] DEFAULT '{}',
    created_at      timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_kb_misses_time ON ai_kb_misses(created_at);
