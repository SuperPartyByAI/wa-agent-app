-- ============================================================
-- 016: Quotation / Proposal Engine
-- Structured quotes from event plans
-- ============================================================

CREATE TABLE IF NOT EXISTS ai_quotes (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_plan_id     UUID REFERENCES ai_event_plans(id) ON DELETE SET NULL,
    conversation_id   UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    client_id         UUID REFERENCES clients(id) ON DELETE SET NULL,
    version_no        INTEGER NOT NULL DEFAULT 1,
    status            TEXT NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft', 'ready', 'sent', 'revised', 'accepted', 'rejected', 'expired', 'cancelled')),

    -- Content
    currency          TEXT NOT NULL DEFAULT 'RON',
    line_items        JSONB NOT NULL DEFAULT '[]'::jsonb,
    -- Each line item: { item_type, service_key, package_key, title, quantity, duration_hours, unit_price, total_price, notes }

    -- Totals
    subtotal          INTEGER DEFAULT 0,       -- in minor units (lei)
    transport_cost    INTEGER DEFAULT 0,
    discount_total    INTEGER DEFAULT 0,
    grand_total       INTEGER DEFAULT 0,

    -- Context
    assumptions       JSONB DEFAULT '[]'::jsonb,
    included_items    JSONB DEFAULT '[]'::jsonb,
    excluded_items    JSONB DEFAULT '[]'::jsonb,
    missing_info_notes JSONB DEFAULT '[]'::jsonb,
    valid_until       DATE,

    -- Control
    generated_by      TEXT DEFAULT 'ai',       -- 'ai', 'operator'
    approved_by_operator BOOLEAN DEFAULT false,
    sent_at           TIMESTAMPTZ,
    accepted_at       TIMESTAMPTZ,
    rejected_at       TIMESTAMPTZ,
    rejection_reason  TEXT,

    -- Metadata
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Quote version history (append-only)
CREATE TABLE IF NOT EXISTS ai_quote_versions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    quote_id        UUID NOT NULL REFERENCES ai_quotes(id) ON DELETE CASCADE,
    version_no      INTEGER NOT NULL,
    snapshot_json   JSONB NOT NULL,      -- full snapshot of the quote at this version
    change_reason   TEXT,
    changed_by      TEXT DEFAULT 'ai',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Quote lifecycle actions (audit trail)
CREATE TABLE IF NOT EXISTS ai_quote_actions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    quote_id        UUID NOT NULL REFERENCES ai_quotes(id) ON DELETE CASCADE,
    action          TEXT NOT NULL,        -- 'created', 'revised', 'ready', 'sent', 'accepted', 'rejected', 'expired', 'cancelled'
    actor           TEXT DEFAULT 'ai',    -- 'ai', 'operator', 'client', 'system'
    details         TEXT,
    metadata_json   JSONB DEFAULT '{}'::jsonb,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_quotes_conv
    ON ai_quotes(conversation_id);

CREATE INDEX IF NOT EXISTS idx_quotes_event_plan
    ON ai_quotes(event_plan_id) WHERE event_plan_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_quotes_status
    ON ai_quotes(status) WHERE status IN ('draft', 'ready', 'sent');

CREATE INDEX IF NOT EXISTS idx_quote_versions_quote
    ON ai_quote_versions(quote_id, version_no DESC);

CREATE INDEX IF NOT EXISTS idx_quote_actions_quote
    ON ai_quote_actions(quote_id, created_at DESC);

-- RLS
ALTER TABLE ai_quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_quote_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_quote_actions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all_quotes" ON ai_quotes
    FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all_quote_versions" ON ai_quote_versions
    FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all_quote_actions" ON ai_quote_actions
    FOR ALL USING (true) WITH CHECK (true);
