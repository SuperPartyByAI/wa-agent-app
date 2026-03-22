-- Migration: Add JSONB column for structural Commercial Policy Engine

ALTER TABLE "public"."ai_knowledge_base"
ADD COLUMN IF NOT EXISTS "policy_config" JSONB DEFAULT NULL;

COMMENT ON COLUMN "public"."ai_knowledge_base"."policy_config" IS 'Structured commercial policy configuration adhering to the AI Engine Schema';
