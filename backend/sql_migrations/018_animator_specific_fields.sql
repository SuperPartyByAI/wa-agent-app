-- ============================================================
-- 018: Add Animator specific fields to ai_event_plans
-- ============================================================

ALTER TABLE ai_event_plans ADD COLUMN IF NOT EXISTS child_name TEXT;
ALTER TABLE ai_event_plans ADD COLUMN IF NOT EXISTS duration_hours INTEGER;
ALTER TABLE ai_event_plans ADD COLUMN IF NOT EXISTS animator_count INTEGER;

-- Ensure these new fields are captured in our historical tracking schema if needed (none strictly required for history table since delta_json handles it)
