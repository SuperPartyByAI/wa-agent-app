-- Migration 020: AI Runtime Context table
-- Stores the versionable Context Pack generated from Git/CI/Deploy.
-- The agent reads this at pipeline start to know what tools exist,
-- what version is deployed, and whether there is drift.

CREATE TABLE IF NOT EXISTS ai_runtime_context (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  environment_name TEXT NOT NULL DEFAULT 'production',
  deployed_commit_sha TEXT,
  source_branch   TEXT DEFAULT 'main',

  -- Serialized snapshot of ACTION_REGISTRY at deploy time
  action_registry_snapshot JSONB NOT NULL,
  action_registry_version  TEXT NOT NULL DEFAULT '1.0.0',

  -- Prompt and API contract versioning
  prompt_version           TEXT NOT NULL DEFAULT '1.0.0',
  core_api_contract_version TEXT NOT NULL DEFAULT '1.0.0',

  -- Runtime configuration
  feature_flags            JSONB DEFAULT '{}',
  migration_status_snapshot JSONB DEFAULT '{}',

  -- Timestamps
  last_deployed_at TIMESTAMPTZ DEFAULT NOW(),
  last_verified_at TIMESTAMPTZ DEFAULT NOW(),
  created_at       TIMESTAMPTZ DEFAULT NOW(),

  -- Only one active record per environment
  is_active BOOLEAN DEFAULT TRUE
);

-- Ensure only one active context pack per environment
CREATE UNIQUE INDEX IF NOT EXISTS idx_runtime_context_active
  ON ai_runtime_context (environment_name)
  WHERE is_active = TRUE;

-- RLS: service_role only (no anon access)
ALTER TABLE ai_runtime_context ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_full_access" ON ai_runtime_context
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
