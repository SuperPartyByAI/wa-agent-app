-- Migration 008_sales_playbooks.sql
-- Description: Creates the sales_playbooks table to allow live editing of AI prompts and business playbook rules from the Admin Suite

-- 1. Create the table
CREATE TABLE IF NOT EXISTS public.sales_playbooks (
    key TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    strategy TEXT NOT NULL,
    tone TEXT NOT NULL,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 2. Add comment for PostgREST / Supabase UI
COMMENT ON TABLE public.sales_playbooks IS 'Holds dynamic prompts and strategies for the AI Business Playbook';

-- 3. Enable RLS (Row Level Security)
ALTER TABLE public.sales_playbooks ENABLE ROW LEVEL SECURITY;

-- 4. Create standard policies
-- Allow service_role full access (used by the AI backend)
CREATE POLICY "Enable ALL for service_role on sales_playbooks" 
ON public.sales_playbooks 
FOR ALL USING (true) WITH CHECK (true);

-- Allow authenticated users (Admins) full access
CREATE POLICY "Enable ALL for authenticated on sales_playbooks" 
ON public.sales_playbooks 
FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- 5. Trigger for updated_at
CREATE OR REPLACE FUNCTION update_sales_playbooks_updated_at()
RETURNS TRIGGER AS $$
BEGIN
   NEW.updated_at = now();
   RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sales_playbooks_updated_at ON public.sales_playbooks;
CREATE TRIGGER trg_sales_playbooks_updated_at
BEFORE UPDATE ON public.sales_playbooks
FOR EACH ROW
EXECUTE FUNCTION update_sales_playbooks_updated_at();

-- 6. Insert initial default values (migrated from code)
INSERT INTO public.sales_playbooks (key, name, strategy, tone, description) VALUES
('vague_inquiry', 'Vague/Generic Inquiries', 'Salută prietenos și cere detalii despre ce tip de eveniment organizează (ex. aniversare, botez, corporate) pentru a-i putea recomanda cele mai potrivite servicii. Fii concis, cald și invită la dialog.', 'calm_discovery', 'Used when the user just says hello or asks a very generic question without specifying services.'),
('impatient_price', 'Impatient / Direct to Price', 'Acknowledge the request for pricing. Mention that prices vary by location, duration, and package. Briefly provide a STARTING PRICE range if possible, then IMMEDIATELY ask for the missing parameters (Date, Location, Kids count) to give an exact calculation.', 'professional_helpful', 'Used when early-stage leads ask directly for the price before we have their event details.'),
('standard_collection', 'Standard Data Collection', 'Condu discuția într-un mod prietenos și natural. Cere informațiile logistice de care ai nevoie pentru a-i face o ofertă (cum ar fi data, locația, numărul de copii), dar fără a fi robotic. Poți cere 2-3 detalii o dată pentru a scurta conversația, dar păstrează un ton cald și consultativ.', 'friendly_consultative', 'The default data collection mode when we know the service but are missing key variables.'),
('quotation', 'Quotation Pitch (Offer Generation)', 'Generează oferta clară și structurată. Prezintă serviciul ca fiind soluția ideală. Fii entuziast! La final, invită-i să confirme dacă sunt de acord cu detaliile sau dacă doresc să adăugăm și altceva (ex. baloane, mașină de bule). Nu cere avansul direct, cere acordul pe ofertă.', 'enthusiastic_sales', 'Used when all required fields are collected and the AI sends the price offer.'),
('objection_too_expensive', 'Objection: Too Expensive', 'Arată empatie. Nu te contra cu clientul, ci evidențiază valoarea (recuzită premium, animatori profesioniști, fără costuri ascunse). Dacă e cazul, propune un pachet inferior ca preț sau o durată mai scurtă (ex. 1.5 ore în loc de 2 ore). Rămâi politicos și deschis.', 'empathetic_advisor', 'Used when the client complains about the budget, wants a discount, or says it is too expensive.'),
('objection_thinking', 'Objection: Thinking about it', 'Lasă ușa deschisă fără a presa. "Perfect, vă înțeleg! Vă las oferta aici. Dacă aveți întrebări, sunt la dispoziție." Setează așteptarea că disponibilitatea se poate schimba repede.', 'no_pressure', 'Used when the client says "I will think about it" or "I need to talk to my partner".'),
('upsell_ready', 'Upsell / Cross-Sell (Hot Leads)', 'Dacă oferta a fost acceptată sau sunt foarte interesați (Hot Lead), propune scurt 1 serviciu adițional (ex. Dacă iau Animatori, propune Mașină de Bule sau Vată de Zahăr). Fă-o natural: "Ca idee, la petrecerile de acest gen merge excelent și..."', 'friendly_suggestive', 'Used after an offer is accepted to suggest an additional service naturally.'),
('billing_intent', 'Billing / Invoice Intent', 'Dacă s-a cerut factura sau se discută despre plată, mulțumește scurt pentru confirmare. Cere datele de facturare complete (CUI, Nume Firmă, Adresă, Număr Registrul Comerțului) dacă lipsesc, și invită clientul să semneze contractul sau să achite avansul.', 'professional_warm', 'Used when the client wants to pay or asks for an invoice/bank account details.')
ON CONFLICT (key) DO UPDATE SET 
    strategy = EXCLUDED.strategy,
    tone = EXCLUDED.tone;
