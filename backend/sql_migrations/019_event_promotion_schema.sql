-- ============================================================
-- 019: Event Plan Promotion to Core API Tracking
-- Tracking fields for the split architecture between AI drafting and Core API bookings
-- ============================================================

ALTER TABLE ai_event_plans ADD COLUMN IF NOT EXISTS promoted_to_final_at TIMESTAMPTZ;
ALTER TABLE ai_event_plans ADD COLUMN IF NOT EXISTS promoted_to_final_by TEXT;
ALTER TABLE ai_event_plans ADD COLUMN IF NOT EXISTS final_entity_id UUID;
ALTER TABLE ai_event_plans ADD COLUMN IF NOT EXISTS promotion_status TEXT DEFAULT 'pending'
    CHECK (promotion_status IN ('pending', 'success', 'failed', 'skipped'));
ALTER TABLE ai_event_plans ADD COLUMN IF NOT EXISTS promotion_error TEXT;

-- Index to quickly find failed or pending promotions
CREATE INDEX IF NOT EXISTS idx_event_plans_promotion
    ON ai_event_plans(promotion_status)
    WHERE promotion_status IN ('pending', 'failed');
