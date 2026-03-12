-- Event mutation history (append-only, never delete)
CREATE TABLE IF NOT EXISTS ai_event_mutations (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    conversation_id UUID NOT NULL,
    event_draft_id UUID,
    mutation_type TEXT NOT NULL,
    changed_by TEXT DEFAULT 'ai',
    before_json JSONB,
    after_json JSONB,
    delta_json JSONB,
    reason_summary TEXT,
    confidence INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Soft status on event drafts (no hard delete ever)
ALTER TABLE ai_event_drafts ADD COLUMN IF NOT EXISTS draft_status TEXT DEFAULT 'active';
ALTER TABLE ai_event_drafts ADD COLUMN IF NOT EXISTS draft_status_changed_at TIMESTAMPTZ;
ALTER TABLE ai_event_drafts ADD COLUMN IF NOT EXISTS draft_status_changed_by TEXT;
ALTER TABLE ai_event_drafts ADD COLUMN IF NOT EXISTS cancel_reason TEXT;
ALTER TABLE ai_event_drafts ADD COLUMN IF NOT EXISTS version INTEGER DEFAULT 1;
ALTER TABLE ai_event_drafts ADD COLUMN IF NOT EXISTS services TEXT[];
