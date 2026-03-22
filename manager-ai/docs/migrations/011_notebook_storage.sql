-- Migration 011_notebook_storage.sql
-- Description: Creates the flexible JSON-based template storage for the Slot Filling AI architecture

-- 1. Table for Admin Templates (The Blueprint)
CREATE TABLE IF NOT EXISTS public.ai_notebook_templates (
    key TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    system_prompt_instruction TEXT, -- e.g. "You are an Assistant for Animators. You need to casually find out the details in the schema."
    json_schema JSONB NOT NULL DEFAULT '{}'::jsonb, -- The actual template shape: {"data": "string", "locatie": "string", "nume_copil": "string"}
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 2. Table for Active Client Notebooks (The Filled Template)
CREATE TABLE IF NOT EXISTS public.ai_client_notebooks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    phone_number TEXT NOT NULL,
    template_key TEXT NOT NULL REFERENCES public.ai_notebook_templates(key),
    extracted_data JSONB NOT NULL DEFAULT '{}'::jsonb, -- The live filled slots
    is_complete BOOLEAN DEFAULT false, -- true when all required schema slots are reasonably filled
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    UNIQUE(phone_number, template_key) -- A client has one active notebook per template type
);

-- RLS
ALTER TABLE public.ai_notebook_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_client_notebooks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Enable ALL for service_role on ai_notebook_templates" ON public.ai_notebook_templates FOR ALL USING (true);
CREATE POLICY "Enable ALL for authenticated on ai_notebook_templates" ON public.ai_notebook_templates FOR ALL TO authenticated USING (true);

CREATE POLICY "Enable ALL for service_role on ai_client_notebooks" ON public.ai_client_notebooks FOR ALL USING (true);
CREATE POLICY "Enable ALL for authenticated on ai_client_notebooks" ON public.ai_client_notebooks FOR ALL TO authenticated USING (true);

-- Triggers for updated_at
CREATE OR REPLACE FUNCTION update_notebook_updated_at() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ai_notebook_templates_updated_at ON public.ai_notebook_templates;
CREATE TRIGGER trg_ai_notebook_templates_updated_at BEFORE UPDATE ON public.ai_notebook_templates FOR EACH ROW EXECUTE FUNCTION update_notebook_updated_at();

DROP TRIGGER IF EXISTS trg_ai_client_notebooks_updated_at ON public.ai_client_notebooks;
CREATE TRIGGER trg_ai_client_notebooks_updated_at BEFORE UPDATE ON public.ai_client_notebooks FOR EACH ROW EXECUTE FUNCTION update_notebook_updated_at();

-- Insert Sample Test Template
INSERT INTO public.ai_notebook_templates (key, name, description, system_prompt_instruction, json_schema)
VALUES (
    'test_animator', 
    'Șablon Animator (Test)', 
    'Informații necesare pentru rezervarea unui animator',
    'Află detaliile necesare rezervării într-un mod natural și prietenos. Răspunde la salut, dar direcționează subtil conversația spre a afla data și locația.',
    '{
        "tip": "object",
        "proprietati_cerute": [
            {"nume": "data_eveniment", "descriere": "Data la care are loc petrecerea. Ziua și ideal luna."},
            {"nume": "locatie", "descriere": "Orașul sau locul (Acasă, Restaurant, etc)."},
            {"nume": "nume_copil_sarbatorit", "descriere": "Numele copilului."}
        ]
    }'::jsonb
) ON CONFLICT (key) DO NOTHING;
