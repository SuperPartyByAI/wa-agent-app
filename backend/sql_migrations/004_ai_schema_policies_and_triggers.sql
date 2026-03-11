-- Migration 004: AI Schema Policies, Triggers, and Grants
-- This migration provides the missing elements from 002: auto-update timestamp triggers and basic RLS policies.
-- DEPENDENCIES: Execute 002_ai_schema_baselines.sql before this script.

-- 1. Create the auto-update timestamp function if it doesn't already exist from whts-up core
CREATE OR REPLACE FUNCTION update_ai_modified_column()
RETURNS TRIGGER AS $$
BEGIN
   NEW.updated_at = NOW();
   RETURN NEW;
END;
$$ language 'plpgsql';

-- 2. Add Triggers for auto-updating timestamps
DROP TRIGGER IF EXISTS update_ai_conversation_state_modtime ON ai_conversation_state;
CREATE TRIGGER update_ai_conversation_state_modtime
BEFORE UPDATE ON ai_conversation_state
FOR EACH ROW EXECUTE FUNCTION update_ai_modified_column();

DROP TRIGGER IF EXISTS update_ai_client_memory_modtime ON ai_client_memory;
CREATE TRIGGER update_ai_client_memory_modtime
BEFORE UPDATE ON ai_client_memory
FOR EACH ROW EXECUTE FUNCTION update_ai_modified_column();

DROP TRIGGER IF EXISTS update_ai_event_drafts_modtime ON ai_event_drafts;
CREATE TRIGGER update_ai_event_drafts_modtime
BEFORE UPDATE ON ai_event_drafts
FOR EACH ROW EXECUTE FUNCTION update_ai_modified_column();

DROP TRIGGER IF EXISTS update_ai_ui_schemas_modtime ON ai_ui_schemas;
CREATE TRIGGER update_ai_ui_schemas_modtime
BEFORE UPDATE ON ai_ui_schemas
FOR EACH ROW EXECUTE FUNCTION update_ai_modified_column();


-- 3. RLS Policies (Assuming Anon/Authenticated read access if accessed directly by Android later)
-- Grant basic read access to public roles for schemas and prompts if ever directly queried
GRANT SELECT ON ai_ui_schemas TO anon, authenticated;
CREATE POLICY "Public read ai_ui_schemas" ON ai_ui_schemas FOR SELECT USING (true);

-- Provide service role complete bypass (though service_role bypasses RLS by default, being explicit is safe)
CREATE POLICY "Service Role Full Access ai_conversation_state" ON ai_conversation_state USING (true) WITH CHECK (true);
CREATE POLICY "Service Role Full Access ai_client_memory" ON ai_client_memory USING (true) WITH CHECK (true);
CREATE POLICY "Service Role Full Access ai_event_drafts" ON ai_event_drafts USING (true) WITH CHECK (true);
CREATE POLICY "Service Role Full Access ai_operator_prompts" ON ai_operator_prompts USING (true) WITH CHECK (true);
CREATE POLICY "Service Role Full Access ai_ui_schemas" ON ai_ui_schemas USING (true) WITH CHECK (true);
