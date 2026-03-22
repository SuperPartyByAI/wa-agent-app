-- MIGRATION: 006_audit_trail_table.sql
-- Faza 6: Maturizare de Productie - Creare structura de Observability / Audit
-- Se ruleaza manual din sub-agent dashboard

CREATE TABLE IF NOT EXISTS ai_lead_audit_trail (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    conversation_id uuid NOT NULL,
    event_type text NOT NULL, -- 'state_change', 'nba_change', 'handoff', 'followup_scheduled', 'followup_sent', etc.
    old_state text,
    new_state text,
    reason text, -- Explicația trigger-ului (e.g. 'client_said_revin_eu' sau 'LLM Decision')
    created_at timestamptz DEFAULT now()
);

-- Indeșii pentru căutare rapidă de diagnostic pe conv_id
CREATE INDEX IF NOT EXISTS idx_ai_lead_audit_trail_conversation_id 
ON ai_lead_audit_trail(conversation_id, created_at DESC);
