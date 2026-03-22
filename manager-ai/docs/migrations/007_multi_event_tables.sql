-- Migrare 007 = Trecerea la Multi-Event (Client + Portofoliu Petreceri)

-- ==========================================
-- 1. PROFIL CLIENT (Baza de Identitate B2C)
-- ==========================================
CREATE TABLE IF NOT EXISTS public.ai_client_profiles (
    client_id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    telefon_e164 text UNIQUE NOT NULL,
    nume_client text,
    tip_client text DEFAULT 'persoana_fizica', -- 'persoana_fizica' sau 'firma'
    date_facturare_uzuale jsonb, -- Structuri recurente
    preferinte_recurente text,
    locatii_frecvente text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

-- Index pe numar pentru lookup rapid
CREATE INDEX IF NOT EXISTS idx_client_telefon ON public.ai_client_profiles (telefon_e164);

-- ==========================================
-- 2. SUMAR DE MEMORIE (LLM Context Ingestion)
-- ==========================================
CREATE TABLE IF NOT EXISTS public.ai_client_memory_summary (
    client_id uuid PRIMARY KEY REFERENCES public.ai_client_profiles(client_id) ON DELETE CASCADE,
    summary_text text,
    active_events_count integer DEFAULT 0,
    active_event_ids jsonb DEFAULT '[]'::jsonb, -- Array de event_id active
    last_active_event_id uuid,
    updated_at timestamp with time zone DEFAULT now()
);

-- ==========================================
-- 3. PORTOFOLIU DE EVENIMENTE (Petreceri per Telefon)
-- ==========================================
CREATE TABLE IF NOT EXISTS public.ai_client_events (
    event_id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    client_id uuid NOT NULL REFERENCES public.ai_client_profiles(client_id) ON DELETE CASCADE,
    source_conversation_id text, -- ID-ul primei conversatii web/wa de unde a izvorat
    
    -- Statusuri Master
    status_eveniment text DEFAULT 'draft', -- draft, ofertat, in_discutie, activ, in_modificare, finalizat, anulat
    status_comercial text DEFAULT 'lead_nou', -- lead_nou, colectare_date, ofertat, handoff_operator, inchis
    status_rezervare text DEFAULT 'neconfirmat', -- neconfirmat, asteptare_bani, confirmat, modificat, anulat

    -- Cached Display Fields (Incarcate rapid in LLM Memory Summary fara scanare Deep Draft)
    data_evenimentului date,
    ora_evenimentului text,
    localitate text,
    adresa_completa text,
    tip_eveniment text,
    nume_sarbatorit text,
    varsta_sarbatorit integer,
    servicii_principale jsonb DEFAULT '[]'::jsonb,
    suma_totala_servicii text, -- pt citire "Animatie + Popcorn" usor textuala
    
    is_active boolean DEFAULT true,
    operator_owner text,

    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

-- Indexuri utile:
CREATE INDEX IF NOT EXISTS idx_event_client ON public.ai_client_events (client_id);
CREATE INDEX IF NOT EXISTS idx_event_status ON public.ai_client_events (status_eveniment);
CREATE INDEX IF NOT EXISTS idx_event_active ON public.ai_client_events (is_active) WHERE is_active = true;

-- ==========================================
-- 4. ADAPTAREA TUBE-ULUI DE PARTYDRAFT (Dosarul Extins)
-- Party Draft se leaga de acum la -> event_id, nu doar la conversation_id
-- ==========================================
-- Nota: Deoarece tabela ai_event_drafts e in productie, facem ALTER.
ALTER TABLE public.ai_event_drafts 
ADD COLUMN IF NOT EXISTS event_id uuid REFERENCES public.ai_client_events(event_id) ON DELETE CASCADE,
ADD COLUMN IF NOT EXISTS awaiting_confirmation boolean DEFAULT false; -- Toggle de protectie pt Modificari LLM

-- ==========================================
-- 5. CHANGE LOG / AUDIT PER EVENIMENT (Confirmare Mutatii)
-- ==========================================
CREATE TABLE IF NOT EXISTS public.ai_event_change_log (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    event_id uuid NOT NULL REFERENCES public.ai_client_events(event_id) ON DELETE CASCADE,
    client_id uuid REFERENCES public.ai_client_profiles(client_id) ON DELETE SET NULL,
    
    changed_field text NOT NULL,
    old_value text,
    new_value text,
    
    requested_by text DEFAULT 'client', -- 'client', 'agent_ai', 'operator'
    change_reason text,
    
    confirmed_by_client boolean DEFAULT false, -- Semnal ca a trecut de gate-ul de Disambiguare / OK-ul explicit.
    
    created_at timestamp with time zone DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_change_log_event ON public.ai_event_change_log (event_id);
