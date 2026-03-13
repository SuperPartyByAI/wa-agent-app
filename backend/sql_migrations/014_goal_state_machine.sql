-- ============================================================
-- 014: Goal State Machine
-- Persistent workflow state per conversation
-- ============================================================

-- Valid goal states
DO $$ BEGIN
    CREATE TYPE goal_state_enum AS ENUM (
        'new_lead',
        'greeting',
        'discovery',
        'service_selection',
        'event_qualification',
        'package_recommendation',
        'quotation_draft',
        'quotation_sent',
        'objection_handling',
        'booking_pending',
        'booking_confirmed',
        'reschedule_pending',
        'cancelled',
        'completed'
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Current goal state per conversation (one row per conversation)
CREATE TABLE IF NOT EXISTS ai_goal_states (
    conversation_id   UUID PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE,
    current_state     TEXT NOT NULL DEFAULT 'new_lead',
    previous_state    TEXT,
    state_confidence  INTEGER DEFAULT 80,
    entered_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Executive reasoning output
    next_best_action       TEXT,         -- e.g. 'ask_guest_count', 'recommend_packages', 'generate_quote'
    next_best_question     TEXT,         -- human-readable question to ask
    explanation_for_operator TEXT,       -- why AI chose this action
    blocking_reasons       JSONB DEFAULT '[]'::jsonb,
    -- Metadata
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by        TEXT DEFAULT 'system'  -- 'ai', 'operator', 'system'
);

-- Append-only history of goal state transitions
CREATE TABLE IF NOT EXISTS ai_goal_state_history (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id  UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    from_state       TEXT,
    to_state         TEXT NOT NULL,
    trigger          TEXT,              -- what caused the transition: 'message', 'mutation', 'operator', 'timeout'
    reason           TEXT,              -- human-readable reason
    confidence       INTEGER DEFAULT 80,
    metadata_json    JSONB DEFAULT '{}'::jsonb,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_goal_state_history_conv
    ON ai_goal_state_history(conversation_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_goal_states_state
    ON ai_goal_states(current_state);

-- RLS
ALTER TABLE ai_goal_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_goal_state_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all_goal_states" ON ai_goal_states
    FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all_goal_state_history" ON ai_goal_state_history
    FOR ALL USING (true) WITH CHECK (true);
