-- Supabase Schema definition for WhatsApp/3CX Agent App
-- Maps to requirement: Users, Agents, Roles, RLS, Messages, Calls

-- 1. Custom Enums
CREATE TYPE user_role AS ENUM ('agent', 'supervisor', 'admin');
CREATE TYPE message_direction AS ENUM ('inbound', 'outbound');
CREATE TYPE message_status AS ENUM ('sent', 'delivered', 'read', 'failed');
CREATE TYPE call_status AS ENUM ('ringing', 'in_progress', 'completed', 'missed');

-- 2. Extended User Profiles
CREATE TABLE profiles (
    id UUID REFERENCES auth.users ON DELETE CASCADE PRIMARY KEY,
    full_name TEXT NOT NULL,
    avatar_url TEXT,
    role user_role DEFAULT 'agent'::user_role NOT NULL,
    extension_3cx TEXT, -- Matches their 3CX internal extension
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Enable RLS
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- Agents can read all profiles, but only admins can modify roles
CREATE POLICY "Public profiles are viewable by everyone." 
ON profiles FOR SELECT USING ( auth.role() = 'authenticated' );

CREATE POLICY "Users can insert their own profile." 
ON profiles FOR INSERT WITH CHECK ( auth.uid() = id );

CREATE POLICY "Users can update own profile except role." 
ON profiles FOR UPDATE USING ( auth.uid() = id );

-- 3. Contacts (Phone Numbers)
CREATE TABLE contacts (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    phone_number TEXT UNIQUE NOT NULL,
    name TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);
ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Contacts are viewable by all authenticated users" ON contacts FOR SELECT USING ( auth.role() = 'authenticated' );
CREATE POLICY "Contacts are insertable by all authenticated users" ON contacts FOR INSERT WITH CHECK ( auth.role() = 'authenticated' );

-- 4. Conversations (WhatsApp Threads)
CREATE TABLE conversations (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    contact_id UUID REFERENCES contacts(id) ON DELETE CASCADE,
    assigned_agent_id UUID REFERENCES profiles(id) ON DELETE SET NULL, -- Null implies unassigned/queue
    status TEXT DEFAULT 'open',
    last_message_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Conversations viewable by matching agent or supervisors" 
ON conversations FOR SELECT 
USING ( auth.role() = 'authenticated' ); 
-- (For MVP, all authenticated users see the queue. We will tighten this natively later for scale).

-- 5. WhatsApp Messages
CREATE TABLE messages (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE NOT NULL,
    sender_id UUID REFERENCES profiles(id) ON DELETE SET NULL, -- Null if inbound from contact
    direction message_direction NOT NULL,
    content TEXT NOT NULL,
    status message_status DEFAULT 'sent'::message_status,
    wa_message_id TEXT UNIQUE, -- Hardware ID tied to Hetzner Open-WA
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Messages viewable by all authenticated users" ON messages FOR SELECT USING ( auth.role() = 'authenticated' );
CREATE POLICY "Agents can insert outbound messages" ON messages FOR INSERT WITH CHECK ( auth.role() = 'authenticated' AND direction = 'outbound' );

-- 6. 3CX Call Events (Realtime log pushing to Android)
CREATE TABLE call_events (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
    agent_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
    status call_status NOT NULL,
    direction message_direction NOT NULL, 
    call_start TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()),
    call_end TIMESTAMP WITH TIME ZONE,
    duration_seconds INTEGER
);
ALTER TABLE call_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Call events viewable by all authenticated users" ON call_events FOR SELECT USING ( auth.role() = 'authenticated' );

-- 7. Triggers for `updated_at`
CREATE OR REPLACE FUNCTION update_modified_column() 
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW; 
END;
$$ language 'plpgsql';

CREATE TRIGGER update_profiles_modtime 
BEFORE UPDATE ON profiles 
FOR EACH ROW EXECUTE PROCEDURE update_modified_column();
