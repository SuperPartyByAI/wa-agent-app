# SQL Migrations for Superparty wa-agent-app

This directory contains the SQL files needed to configure the Supabase PostgreSQL database for the AI-Agent integrations.

## Execution Order

Migrations must be executed in the following order:

1. \`001_brand_aliases.sql\` - Baseline for brand identity routing.
2. \`002_ai_schema_baselines.sql\` - Core AI tables (\`ai_client_memory\`, \`ai_conversation_state\`, etc.).
3. \`003_collaborator_onboarding_schema.sql\` - Onboarding AI UI state records.
4. \`004_ai_schema_policies_and_triggers.sql\` - Essential Triggers for \`updated_at\` and basic RLS policies.

## Preconditions

- The \`public\` schema must exist in Supabase.
- A service role key must be provisioned for backend ingestion.

## Standardized Configuration (.env) Rules

Both \`whts-up\` and \`ManagerAi\` deploy from a single GitHub path (\`/opt/wa-agent-app\`), but load their environment natively.

- **whts-up (89.167.115.150)**: Env loaded natively from \`/opt/wa-agent-app/backend/.env\`
- **ManagerAi (91.98.16.90)**: Env loaded natively from \`/opt/wa-agent-app/manager-ai/.env\`

_WARNING: NEVER commit `.env` files to this repository. The SSH deploy scripts migrate these securely during runtime._
