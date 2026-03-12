-- Migration: ai_deferred_followups table
-- Tracks scheduled deferred follow-ups for conversations where AI decided to wait.

CREATE TABLE IF NOT EXISTS ai_deferred_followups (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    conversation_id UUID NOT NULL,

    -- Scheduling
    follow_up_at TIMESTAMPTZ NOT NULL,
    scheduled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Context at scheduling time
    follow_up_reason TEXT NOT NULL,           -- wait_for_more_messages | wait_for_missing_info
    open_question_detected BOOLEAN DEFAULT FALSE,
    customer_intent_unanswered BOOLEAN DEFAULT FALSE,
    missing_fields TEXT[],                     -- e.g. ['event_date','location','guest_count']
    last_unanswered_customer_message_at TIMESTAMPTZ,
    trigger_message_id TEXT,                   -- message_id that triggered the scheduling
    next_step_at_schedule TEXT,                -- next_step value when scheduled

    -- Lifecycle
    status TEXT NOT NULL DEFAULT 'pending',    -- pending | triggered | sent | skipped | cleared
    skip_reason TEXT,                          -- new_message | ai_already_replied | no_open_question | blocked_state | expired | idempotency
    follow_up_attempted_at TIMESTAMPTZ,
    follow_up_sent_at TIMESTAMPTZ,
    follow_up_reply TEXT,                      -- the reply that was sent (if any)

    -- Safety
    worker_lock_id TEXT,                       -- idempotency lock for worker
    worker_lock_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for worker query: find pending follow-ups that are due
CREATE INDEX IF NOT EXISTS idx_deferred_followups_pending
    ON ai_deferred_followups (status, follow_up_at)
    WHERE status = 'pending';

-- Index for conversation lookup
CREATE INDEX IF NOT EXISTS idx_deferred_followups_conv
    ON ai_deferred_followups (conversation_id, status);

-- Only one pending follow-up per conversation at a time
CREATE UNIQUE INDEX IF NOT EXISTS idx_deferred_followups_one_pending
    ON ai_deferred_followups (conversation_id)
    WHERE status = 'pending';
