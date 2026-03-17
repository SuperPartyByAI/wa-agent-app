-- ═══════════════════════════════════════════════════════════
-- Employee Auth + Onboarding — Database Migration
-- Supabase: yvfhqadfmjgbzetanfxs
-- ═══════════════════════════════════════════════════════════

-- 1. Extend employees table with auth + onboarding columns
ALTER TABLE employees ADD COLUMN IF NOT EXISTS auth_user_id UUID;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS google_email TEXT;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS onboarding_status TEXT DEFAULT 'pending';
-- Statuses: pending | contract_signed | id_uploaded | selfie_done | ai_verified | admin_approved | rejected
ALTER TABLE employees ADD COLUMN IF NOT EXISTS id_photo_url TEXT;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS selfie_url TEXT;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS ai_face_match_score DECIMAL;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS ai_face_match_result TEXT;
-- Results: match | no_match | error
ALTER TABLE employees ADD COLUMN IF NOT EXISTS contract_signed_at TIMESTAMPTZ;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS approved_by TEXT;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'employee';
-- Roles: admin | employee

-- 2. Create employee_sessions table for server-side session management
CREATE TABLE IF NOT EXISTS employee_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID REFERENCES employees(id) ON DELETE CASCADE,
    session_token TEXT UNIQUE NOT NULL,
    google_email TEXT NOT NULL,
    google_name TEXT,
    google_avatar TEXT,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_employee_sessions_token ON employee_sessions(session_token);
CREATE INDEX IF NOT EXISTS idx_employee_sessions_email ON employee_sessions(google_email);

-- 3. Storage bucket for employee documents
INSERT INTO storage.buckets (id, name, public) 
VALUES ('employee-docs', 'employee-docs', false)
ON CONFLICT (id) DO NOTHING;
