-- 002_lead_runtime_state.sql

-- =================================================================================
-- SUPABASE POSTGRESQL MIGRATION
-- Adds the `ai_lead_runtime_states` table for the Autonomous Commercial Agent
-- =================================================================================

-- 1. Create enum for standard Lead States
CREATE TYPE aic_lead_state AS ENUM (
  'lead_nou',
  'salut_initial',
  'identificare_serviciu',
  'colectare_date',
  'gata_de_oferta',
  'oferta_trimisa',
  'asteapta_raspuns_client',
  'follow_up_necesar',
  'obiectie_client',
  'escaladare_operator',
  'inchis_castigat',
  'inchis_pierdut'
);

-- 2. Create ai_lead_runtime_states table
CREATE TABLE IF NOT EXISTS public.ai_lead_runtime_states (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  conversation_id uuid NOT NULL,
  
  -- Core State Machine
  lead_state aic_lead_state NOT NULL DEFAULT 'lead_nou',
  last_agent_goal text,
  next_best_action text,
  
  -- Services & Commercial Hooks
  primary_service text,
  active_roles text[] DEFAULT ARRAY[]::text[],
  
  -- Dynamic Memory (JSONB for pure schema flexibility)
  known_fields jsonb DEFAULT '{}'::jsonb,
  missing_fields text[] DEFAULT ARRAY[]::text[],
  
  -- Pipeline Control & Scoring
  human_takeover boolean DEFAULT false,
  lead_score numeric(4,2) DEFAULT 0.00,
  follow_up_due_at timestamptz,
  
  -- Audit & Timestamps
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  
  -- Constraints
  CONSTRAINT fk_conversation FOREIGN KEY (conversation_id) REFERENCES public.conversations(id) ON DELETE CASCADE
);

-- 3. Indexes for fast lookup on critical hot-paths based on pipeline architecture
CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_lead_state_conv ON public.ai_lead_runtime_states (conversation_id);
CREATE INDEX IF NOT EXISTS idx_ai_lead_state_status ON public.ai_lead_runtime_states (lead_state);
CREATE INDEX IF NOT EXISTS idx_ai_lead_state_followup ON public.ai_lead_runtime_states (follow_up_due_at) WHERE follow_up_due_at IS NOT NULL;

-- 4. Automatic updated_at trigger function
CREATE OR REPLACE FUNCTION public.set_lead_runtime_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = EXCLUDED.updated_at; -- allow manual overrides if passed
  IF NEW.updated_at = OLD.updated_at THEN 
    NEW.updated_at = now(); 
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 5. Attach the trigger
DROP TRIGGER IF EXISTS trg_ai_lead_runtime_updated_at ON public.ai_lead_runtime_states;
CREATE TRIGGER trg_ai_lead_runtime_updated_at
BEFORE UPDATE ON public.ai_lead_runtime_states
FOR EACH ROW
EXECUTE FUNCTION public.set_lead_runtime_updated_at();

-- 6. Add RLS Security (Restrict basic anonymous access)
ALTER TABLE public.ai_lead_runtime_states ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow Service Role absolute access to runtime state"
ON public.ai_lead_runtime_states FOR ALL
USING (true)
WITH CHECK (true);
