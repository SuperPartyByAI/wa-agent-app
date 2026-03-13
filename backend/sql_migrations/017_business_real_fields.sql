-- ============================================================
-- 017: Business-Real Event Plan — Commercial & Retention Fields
-- ALTER existing ai_event_plans + ai_goal_states
-- ============================================================

-- ── 1. Rename guest_count → children_count_estimate ──
DO $$ BEGIN
    ALTER TABLE ai_event_plans RENAME COLUMN guest_count TO children_count_estimate;
EXCEPTION WHEN undefined_column THEN
    -- Column doesn't exist as guest_count, check if children_count_estimate exists
    BEGIN
        ALTER TABLE ai_event_plans ADD COLUMN children_count_estimate INTEGER;
    EXCEPTION WHEN duplicate_column THEN NULL;
    END;
END $$;

-- ── 2. Add participant fields ──
ALTER TABLE ai_event_plans ADD COLUMN IF NOT EXISTS adults_count_estimate INTEGER;
ALTER TABLE ai_event_plans ADD COLUMN IF NOT EXISTS replacements JSONB DEFAULT '[]'::jsonb;

-- ── 3. Add commercial closing fields ──
ALTER TABLE ai_event_plans ADD COLUMN IF NOT EXISTS payment_method_preference TEXT DEFAULT 'unknown'
    CHECK (payment_method_preference IN ('cash', 'card', 'transfer', 'factura', 'unknown'));
ALTER TABLE ai_event_plans ADD COLUMN IF NOT EXISTS invoice_requested TEXT DEFAULT 'unknown'
    CHECK (invoice_requested IN ('true', 'false', 'unknown'));
ALTER TABLE ai_event_plans ADD COLUMN IF NOT EXISTS advance_required TEXT DEFAULT 'unknown'
    CHECK (advance_required IN ('true', 'false', 'unknown'));
ALTER TABLE ai_event_plans ADD COLUMN IF NOT EXISTS advance_status TEXT DEFAULT 'unknown'
    CHECK (advance_status IN ('none', 'requested', 'promised', 'paid', 'not_required', 'unknown'));
ALTER TABLE ai_event_plans ADD COLUMN IF NOT EXISTS advance_amount INTEGER;
ALTER TABLE ai_event_plans ADD COLUMN IF NOT EXISTS billing_details_status TEXT DEFAULT 'missing'
    CHECK (billing_details_status IN ('missing', 'partial', 'complete', 'not_needed'));
ALTER TABLE ai_event_plans ADD COLUMN IF NOT EXISTS payment_notes TEXT;

-- ── 4. Add readiness_for_recommendation ──
ALTER TABLE ai_event_plans ADD COLUMN IF NOT EXISTS readiness_for_recommendation BOOLEAN DEFAULT false;

-- ── 5. Add soft archive / retention fields ──
ALTER TABLE ai_event_plans ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
ALTER TABLE ai_event_plans ADD COLUMN IF NOT EXISTS archived_by TEXT;
ALTER TABLE ai_event_plans ADD COLUMN IF NOT EXISTS archive_reason TEXT;
ALTER TABLE ai_event_plans ADD COLUMN IF NOT EXISTS hidden_from_active_ui BOOLEAN DEFAULT false;
ALTER TABLE ai_event_plans ADD COLUMN IF NOT EXISTS exclude_from_payroll BOOLEAN DEFAULT false;

-- ── 6. Add control fields ──
ALTER TABLE ai_event_plans ADD COLUMN IF NOT EXISTS source_of_last_mutation TEXT DEFAULT 'ai';
ALTER TABLE ai_event_plans ADD COLUMN IF NOT EXISTS operator_locked BOOLEAN DEFAULT false;
ALTER TABLE ai_event_plans ADD COLUMN IF NOT EXISTS human_takeover_active_snapshot BOOLEAN DEFAULT false;

-- ── 7. Expand status CHECK to include new business statuses ──
-- Drop old constraint, add new one
ALTER TABLE ai_event_plans DROP CONSTRAINT IF EXISTS ai_event_plans_status_check;
ALTER TABLE ai_event_plans ADD CONSTRAINT ai_event_plans_status_check
    CHECK (status IN (
        'draft', 'active', 'awaiting_operator_review',
        'quote_ready', 'booking_ready', 'confirmed',
        'archived', 'cancelled', 'completed', 'inactive'
    ));

-- ── 8. Indexes for soft archive queries ──
CREATE INDEX IF NOT EXISTS idx_event_plans_active_not_hidden
    ON ai_event_plans(conversation_id)
    WHERE status IN ('draft', 'active', 'awaiting_operator_review', 'quote_ready', 'booking_ready')
    AND hidden_from_active_ui = false;

CREATE INDEX IF NOT EXISTS idx_event_plans_archive
    ON ai_event_plans(archived_at)
    WHERE archived_at IS NOT NULL;

-- ── 9. Soft archive retention fields on ai_quotes ──
ALTER TABLE ai_quotes ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
ALTER TABLE ai_quotes ADD COLUMN IF NOT EXISTS archived_by TEXT;
ALTER TABLE ai_quotes ADD COLUMN IF NOT EXISTS archive_reason TEXT;
ALTER TABLE ai_quotes ADD COLUMN IF NOT EXISTS hidden_from_active_ui BOOLEAN DEFAULT false;

-- ── 10. Soft archive retention fields on ai_goal_states ──
ALTER TABLE ai_goal_states ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
ALTER TABLE ai_goal_states ADD COLUMN IF NOT EXISTS archived_by TEXT;
