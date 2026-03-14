-- Adaugare capabilitati nativelor de Arcade in modelul comercial Event Plan
-- Regula: 'linear_meters' si 'model_choice' trebuie sa fie suportate ca native pe schema

ALTER TABLE public.ai_event_plans
ADD COLUMN linear_meters integer,
ADD COLUMN model_choice text;

-- Idem pe tabela de pastrare versiuni history (daca exista trigger de log):
ALTER TABLE public.ai_event_plan_history
ADD COLUMN linear_meters integer,
ADD COLUMN model_choice text;
