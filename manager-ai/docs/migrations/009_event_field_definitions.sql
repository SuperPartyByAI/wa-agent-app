CREATE TABLE IF NOT EXISTS public.event_field_definitions (
    field_key TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    data_type TEXT NOT NULL,
    description TEXT,
    required_for_booking BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE public.event_field_definitions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Enable ALL for service_role on event_field_definitions"
ON public.event_field_definitions
FOR ALL USING (true) WITH CHECK (true);

CREATE POLICY "Enable ALL for authenticated on event_field_definitions"
ON public.event_field_definitions
FOR ALL TO authenticated USING (true) WITH CHECK (true);
