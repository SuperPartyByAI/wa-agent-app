-- Enable Row Level Security on the client_identity_links table
ALTER TABLE client_identity_links ENABLE ROW LEVEL SECURITY;

-- Drop previous policies if they exist (to ensure idempotency)
DROP POLICY IF EXISTS "Allow service_role full access" ON client_identity_links;
DROP POLICY IF EXISTS "Restrict PII to admin email" ON client_identity_links;

-- Create policy for backend automated operations (service_role / postgres)
CREATE POLICY "Allow service_role full access"
ON client_identity_links
FOR ALL
USING (true)
WITH CHECK (true);

-- Create policy for the Android application endpoints (authenticated users using the anon key JWT)
-- Only the specified Admin email is permitted to extract records locally
CREATE POLICY "Restrict PII to admin email"
ON client_identity_links
FOR SELECT
TO authenticated
USING (
  auth.jwt() ->> 'email' = 'ursache.andrei1995@gmail.com'
);
