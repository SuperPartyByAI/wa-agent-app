-- 1. ai_conversation_state
CREATE TABLE IF NOT EXISTS ai_conversation_state (
    conversation_id UUID PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE,
    current_intent TEXT,
    current_stage TEXT,
    latest_summary TEXT,
    open_questions_json JSONB DEFAULT '[]'::jsonb,
    next_best_action TEXT,
    last_processed_message_id TEXT,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. ai_client_memory
CREATE TABLE IF NOT EXISTS ai_client_memory (
    client_id UUID PRIMARY KEY REFERENCES clients(id) ON DELETE CASCADE,
    priority_level TEXT DEFAULT 'normal',
    memory_json JSONB DEFAULT '{}'::jsonb,
    preferences_json JSONB DEFAULT '{}'::jsonb,
    decision_makers_json JSONB DEFAULT '[]'::jsonb,
    restrictions_json JSONB DEFAULT '[]'::jsonb,
    internal_notes_summary TEXT,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. ai_event_drafts
CREATE TABLE IF NOT EXISTS ai_event_drafts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
    client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
    draft_type TEXT DEFAULT 'standard_party',
    status TEXT DEFAULT 'draft',
    structured_data_json JSONB DEFAULT '{}'::jsonb,
    missing_fields_json JSONB DEFAULT '[]'::jsonb,
    confidence_score INTEGER DEFAULT 0,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. ai_operator_prompts
CREATE TABLE IF NOT EXISTS ai_operator_prompts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
    client_id UUID REFERENCES clients(id) ON DELETE SET NULL,
    prompt_text TEXT NOT NULL,
    prompt_type TEXT DEFAULT 'note',
    created_by TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. ai_ui_schemas
CREATE TABLE IF NOT EXISTS ai_ui_schemas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
    screen_type TEXT NOT NULL,
    schema_version TEXT DEFAULT '1.0',
    layout_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    generated_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_ai_event_drafts_conv ON ai_event_drafts(conversation_id);
CREATE INDEX IF NOT EXISTS idx_ai_event_drafts_client ON ai_event_drafts(client_id);
CREATE INDEX IF NOT EXISTS idx_ai_operator_prompts_conv ON ai_operator_prompts(conversation_id);
CREATE INDEX IF NOT EXISTS idx_ai_ui_schemas_conv ON ai_ui_schemas(conversation_id);

-- Check Basic RLS mirroring
ALTER TABLE ai_conversation_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_client_memory ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_event_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_operator_prompts ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_ui_schemas ENABLE ROW LEVEL SECURITY;
