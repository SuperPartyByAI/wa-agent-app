-- ============================================================
-- 015: Event Plan Assembly Engine
-- Persistent structured event plan per conversation
-- ============================================================

CREATE TABLE IF NOT EXISTS ai_event_plans (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id         UUID REFERENCES clients(id) ON DELETE SET NULL,
    conversation_id   UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    status            TEXT NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active', 'archived', 'cancelled')),

    -- Event identity
    event_type        TEXT,              -- 'petrecere', 'botez', 'nunta', 'corporate', etc.
    occasion          TEXT,              -- 'zi_nastere', 'revelion', 'sfarsit_an', etc.
    event_date        TEXT,              -- extracted date string
    event_time        TEXT,              -- extracted time string
    location          TEXT,
    venue_type        TEXT,              -- 'acasa', 'restaurant', 'sala_jocuri', etc.

    -- Participants
    guest_count       INTEGER,
    child_age         INTEGER,
    audience_notes    TEXT,

    -- Services
    requested_services  JSONB DEFAULT '[]'::jsonb,     -- all services mentioned
    confirmed_services  JSONB DEFAULT '[]'::jsonb,     -- explicitly confirmed
    removed_services    JSONB DEFAULT '[]'::jsonb,     -- removed/rejected
    candidate_services  JSONB DEFAULT '[]'::jsonb,     -- suggested, not confirmed

    -- Packages & recommendations
    candidate_packages  JSONB DEFAULT '[]'::jsonb,     -- e.g. [{service: 'animator', package: 3}]
    selected_package    JSONB,                          -- e.g. {service: 'animator', package: 3, duration: 3}
    recommended_bundle  JSONB,                          -- AI-suggested combo
    extras              JSONB DEFAULT '[]'::jsonb,

    -- Budget
    budget_min        INTEGER,
    budget_max        INTEGER,
    budget_signal     TEXT,              -- 'cheap', 'flexible', 'premium', 'unknown'
    pricing_snapshot  JSONB,             -- snapshot of prices at quote time
    assumptions       JSONB DEFAULT '[]'::jsonb,

    -- Quality / completeness
    missing_fields    JSONB DEFAULT '[]'::jsonb,
    confirmed_fields  JSONB DEFAULT '[]'::jsonb,
    confidence        INTEGER DEFAULT 50,
    readiness_for_quote   BOOLEAN DEFAULT false,
    readiness_for_booking BOOLEAN DEFAULT false,

    -- Transport
    transport_zone    TEXT,

    -- Control
    last_updated_by   TEXT DEFAULT 'ai',  -- 'ai', 'operator', 'client'
    last_updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Append-only mutation history for event plans
CREATE TABLE IF NOT EXISTS ai_event_plan_history (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_plan_id   UUID NOT NULL REFERENCES ai_event_plans(id) ON DELETE CASCADE,
    conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    mutation_type   TEXT NOT NULL,        -- 'create', 'add_service', 'update_date', 'select_package', etc.
    changed_by      TEXT DEFAULT 'ai',
    before_json     JSONB,
    after_json      JSONB,
    delta_json      JSONB,
    reason          TEXT,
    confidence      INTEGER DEFAULT 80,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_event_plans_conv
    ON ai_event_plans(conversation_id);

CREATE INDEX IF NOT EXISTS idx_event_plans_client
    ON ai_event_plans(client_id) WHERE client_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_event_plans_active
    ON ai_event_plans(conversation_id) WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_event_plan_history_plan
    ON ai_event_plan_history(event_plan_id, created_at DESC);

-- RLS
ALTER TABLE ai_event_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_event_plan_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all_event_plans" ON ai_event_plans
    FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all_event_plan_history" ON ai_event_plan_history
    FOR ALL USING (true) WITH CHECK (true);
