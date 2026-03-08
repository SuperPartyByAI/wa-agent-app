-- =========================================================
-- EXTENSIONS
-- =========================================================
create extension if not exists "pgcrypto";
create extension if not exists "uuid-ossp";

-- =========================================================
-- ENUMS
-- =========================================================
do $$
begin
  if not exists (select 1 from pg_type where typname = 'app_role') then
    create type app_role as enum ('agent', 'supervisor', 'admin');
  end if;

  if not exists (select 1 from pg_type where typname = 'employee_status') then
    create type employee_status as enum ('active', 'inactive');
  end if;

  if not exists (select 1 from pg_type where typname = 'employee_type') then
    create type employee_type as enum ('animator', 'coordinator', 'driver', 'other');
  end if;

  if not exists (select 1 from pg_type where typname = 'skill_type') then
    create type skill_type as enum (
      'mascot',
      'face_painting',
      'balloons',
      'host',
      'princess',
      'superhero',
      'magic_show',
      'other'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'client_source') then
    create type client_source as enum (
      'whatsapp',
      'call',
      'manual',
      'facebook',
      'instagram',
      'website',
      'other'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'conversation_channel') then
    create type conversation_channel as enum ('whatsapp', 'call', 'internal');
  end if;

  if not exists (select 1 from pg_type where typname = 'conversation_status') then
    create type conversation_status as enum ('open', 'pending', 'closed');
  end if;

  if not exists (select 1 from pg_type where typname = 'message_direction') then
    create type message_direction as enum ('inbound', 'outbound');
  end if;

  if not exists (select 1 from pg_type where typname = 'message_sender_type') then
    create type message_sender_type as enum ('client', 'agent', 'ai', 'system');
  end if;

  if not exists (select 1 from pg_type where typname = 'message_status') then
    create type message_status as enum ('queued', 'sent', 'delivered', 'read', 'failed');
  end if;

  if not exists (select 1 from pg_type where typname = 'call_status') then
    create type call_status as enum ('ringing', 'answered', 'missed', 'completed', 'transferred');
  end if;

  if not exists (select 1 from pg_type where typname = 'event_type_enum') then
    create type event_type_enum as enum (
      'birthday',
      'school',
      'private_party',
      'corporate_kids',
      'other'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'event_status') then
    create type event_status as enum (
      'draft',
      'pending_confirmation',
      'confirmed',
      'assigned',
      'in_progress',
      'completed',
      'cancelled'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'service_type') then
    create type service_type as enum (
      'animator',
      'mascot',
      'balloons',
      'face_painting',
      'mc',
      'photographer',
      'candy_bar',
      'other'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'assignment_status') then
    create type assignment_status as enum ('proposed', 'confirmed', 'declined', 'completed');
  end if;

  if not exists (select 1 from pg_type where typname = 'task_type') then
    create type task_type as enum (
      'call_back',
      'confirm_details',
      'assign_staff',
      'send_offer',
      'collect_payment',
      'reminder',
      'follow_up',
      'other'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'task_status') then
    create type task_status as enum ('open', 'in_progress', 'done', 'cancelled');
  end if;

  if not exists (select 1 from pg_type where typname = 'note_type') then
    create type note_type as enum ('internal', 'ai_summary', 'logistics', 'issue');
  end if;

  if not exists (select 1 from pg_type where typname = 'ai_source_type') then
    create type ai_source_type as enum ('message', 'call', 'conversation');
  end if;

  if not exists (select 1 from pg_type where typname = 'ai_action_type') then
    create type ai_action_type as enum (
      'create_draft_event',
      'summarize',
      'suggest_reply',
      'suggest_staff',
      'create_task',
      'flag_missing_info'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'ai_action_status') then
    create type ai_action_status as enum ('pending', 'completed', 'rejected', 'failed');
  end if;
end$$;

-- =========================================================
-- UPDATED_AT TRIGGER
-- =========================================================
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- =========================================================
-- PROFILES
-- =========================================================
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  email text unique,
  phone text,
  role app_role not null default 'agent',
  avatar_url text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_profiles_updated_at on public.profiles;
create trigger trg_profiles_updated_at
before update on public.profiles
for each row execute procedure public.set_updated_at();

-- =========================================================
-- EMPLOYEES
-- =========================================================
create table if not exists public.employees (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  phone text,
  email text,
  status employee_status not null default 'active',
  employee_type employee_type not null default 'animator',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_employees_updated_at on public.employees;
create trigger trg_employees_updated_at
before update on public.employees
for each row execute procedure public.set_updated_at();

create table if not exists public.employee_skills (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  skill_type skill_type not null,
  level integer not null default 1 check (level between 1 and 5),
  notes text,
  created_at timestamptz not null default now(),
  unique (employee_id, skill_type)
);

create table if not exists public.employee_availability (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references public.employees(id) on delete cascade,
  date date not null,
  start_time time,
  end_time time,
  is_available boolean not null default true,
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists idx_employee_availability_employee_date
  on public.employee_availability(employee_id, date);

-- =========================================================
-- CLIENTS
-- =========================================================
create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  phone text,
  email text,
  source client_source not null default 'manual',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_clients_updated_at on public.clients;
create trigger trg_clients_updated_at
before update on public.clients
for each row execute procedure public.set_updated_at();

create unique index if not exists idx_clients_phone_unique
  on public.clients(phone)
  where phone is not null;

create table if not exists public.client_addresses (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  label text,
  address_text text not null,
  city text,
  location_notes text,
  created_at timestamptz not null default now()
);

-- =========================================================
-- CONVERSATIONS / MESSAGES
-- =========================================================
create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  channel conversation_channel not null,
  status conversation_status not null default 'open',
  assigned_agent_id uuid references public.profiles(id) on delete set null,
  last_message_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_conversations_updated_at on public.conversations;
create trigger trg_conversations_updated_at
before update on public.conversations
for each row execute procedure public.set_updated_at();

create index if not exists idx_conversations_client_id
  on public.conversations(client_id);

create index if not exists idx_conversations_assigned_agent_id
  on public.conversations(assigned_agent_id);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  direction message_direction not null,
  sender_type message_sender_type not null,
  sender_profile_id uuid references public.profiles(id) on delete set null,
  content text not null,
  status message_status not null default 'queued',
  external_message_id text,
  created_at timestamptz not null default now()
);

create unique index if not exists idx_messages_external_message_id_unique
  on public.messages(external_message_id)
  where external_message_id is not null;

create index if not exists idx_messages_conversation_created_at
  on public.messages(conversation_id, created_at desc);

-- =========================================================
-- CALL EVENTS
-- =========================================================
create table if not exists public.call_events (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references public.clients(id) on delete set null,
  conversation_id uuid references public.conversations(id) on delete set null,
  agent_profile_id uuid references public.profiles(id) on delete set null,
  direction message_direction not null,
  status call_status not null,
  from_number text,
  to_number text,
  extension text,
  started_at timestamptz,
  ended_at timestamptz,
  duration_seconds integer,
  recording_url text,
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists idx_call_events_client_id
  on public.call_events(client_id);

create index if not exists idx_call_events_agent_profile_id
  on public.call_events(agent_profile_id);

create index if not exists idx_call_events_started_at
  on public.call_events(started_at desc);

-- =========================================================
-- EVENTS
-- =========================================================
create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete restrict,
  conversation_id uuid references public.conversations(id) on delete set null,
  title text not null,
  event_type event_type_enum not null default 'birthday',
  status event_status not null default 'draft',
  event_date date,
  start_time time,
  end_time time,
  location_text text,
  city text,
  children_count integer,
  budget_estimate numeric(10,2),
  theme text,
  special_requests text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_events_updated_at on public.events;
create trigger trg_events_updated_at
before update on public.events
for each row execute procedure public.set_updated_at();

create index if not exists idx_events_client_id
  on public.events(client_id);

create index if not exists idx_events_event_date
  on public.events(event_date);

create index if not exists idx_events_status
  on public.events(status);

create table if not exists public.event_services (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  service_type service_type not null,
  quantity integer not null default 1 check (quantity > 0),
  notes text,
  price_estimate numeric(10,2),
  created_at timestamptz not null default now()
);

create table if not exists public.event_assignments (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  role_on_event text,
  assignment_status assignment_status not null default 'proposed',
  notes text,
  created_at timestamptz not null default now(),
  unique (event_id, employee_id)
);

create index if not exists idx_event_assignments_event_id
  on public.event_assignments(event_id);

create index if not exists idx_event_assignments_employee_id
  on public.event_assignments(employee_id);

-- =========================================================
-- TASKS / NOTES
-- =========================================================
create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  event_id uuid references public.events(id) on delete cascade,
  client_id uuid references public.clients(id) on delete cascade,
  assigned_to_profile_id uuid references public.profiles(id) on delete set null,
  task_type task_type not null,
  status task_status not null default 'open',
  due_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_tasks_updated_at on public.tasks;
create trigger trg_tasks_updated_at
before update on public.tasks
for each row execute procedure public.set_updated_at();

create index if not exists idx_tasks_event_id
  on public.tasks(event_id);

create index if not exists idx_tasks_assigned_to_profile_id
  on public.tasks(assigned_to_profile_id);

create index if not exists idx_tasks_status_due_at
  on public.tasks(status, due_at);

create table if not exists public.event_notes (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  author_profile_id uuid references public.profiles(id) on delete set null,
  note_type note_type not null default 'internal',
  content text not null,
  created_at timestamptz not null default now()
);

-- =========================================================
-- AI TABLES
-- =========================================================
create table if not exists public.ai_extractions (
  id uuid primary key default gen_random_uuid(),
  source_type ai_source_type not null,
  source_id uuid not null,
  client_id uuid references public.clients(id) on delete set null,
  event_id uuid references public.events(id) on delete set null,
  extracted_date date,
  extracted_time time,
  extracted_location text,
  extracted_budget numeric(10,2),
  extracted_children_count integer,
  extracted_theme text,
  confidence_score numeric(4,3),
  raw_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_ai_extractions_client_id
  on public.ai_extractions(client_id);

create index if not exists idx_ai_extractions_event_id
  on public.ai_extractions(event_id);

create table if not exists public.ai_actions (
  id uuid primary key default gen_random_uuid(),
  event_id uuid references public.events(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete cascade,
  action_type ai_action_type not null,
  status ai_action_status not null default 'pending',
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_ai_actions_event_id
  on public.ai_actions(event_id);

create index if not exists idx_ai_actions_conversation_id
  on public.ai_actions(conversation_id);

-- =========================================================
-- OPTIONAL: WHATSAPP SESSIONS
-- =========================================================
create table if not exists public.whatsapp_sessions (
  id uuid primary key default gen_random_uuid(),
  session_key text not null unique,
  label text,
  phone_number text,
  status text not null default 'disconnected',
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_whatsapp_sessions_updated_at on public.whatsapp_sessions;
create trigger trg_whatsapp_sessions_updated_at
before update on public.whatsapp_sessions
for each row execute procedure public.set_updated_at();

-- =========================================================
-- BASIC RLS
-- =========================================================
alter table public.profiles enable row level security;
alter table public.employees enable row level security;
alter table public.employee_skills enable row level security;
alter table public.employee_availability enable row level security;
alter table public.clients enable row level security;
alter table public.client_addresses enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.call_events enable row level security;
alter table public.events enable row level security;
alter table public.event_services enable row level security;
alter table public.event_assignments enable row level security;
alter table public.tasks enable row level security;
alter table public.event_notes enable row level security;
alter table public.ai_extractions enable row level security;
alter table public.ai_actions enable row level security;
alter table public.whatsapp_sessions enable row level security;

-- =========================================================
-- HELPER FUNCTION FOR ROLE CHECK
-- assumes profile exists for authenticated user
-- =========================================================
create or replace function public.current_app_role()
returns app_role
language sql
stable
as $$
  select role
  from public.profiles
  where id = auth.uid()
$$;

-- =========================================================
-- SIMPLE MVP POLICIES
-- authenticated users can read most business data
-- admins/supervisors can write more broadly
-- =========================================================

drop policy if exists "profiles_select_authenticated" on public.profiles;
create policy "profiles_select_authenticated" on public.profiles for select to authenticated using (true);
drop policy if exists "profiles_insert_self" on public.profiles;
create policy "profiles_insert_self" on public.profiles for insert to authenticated with check (id = auth.uid());
drop policy if exists "profiles_update_self_or_admin" on public.profiles;
create policy "profiles_update_self_or_admin" on public.profiles for update to authenticated using (id = auth.uid() or public.current_app_role() in ('admin', 'supervisor')) with check (id = auth.uid() or public.current_app_role() in ('admin', 'supervisor'));
drop policy if exists "employees_select_authenticated" on public.employees;
create policy "employees_select_authenticated" on public.employees for select to authenticated using (true);
drop policy if exists "employee_skills_select_authenticated" on public.employee_skills;
create policy "employee_skills_select_authenticated" on public.employee_skills for select to authenticated using (true);
drop policy if exists "employee_availability_select_authenticated" on public.employee_availability;
create policy "employee_availability_select_authenticated" on public.employee_availability for select to authenticated using (true);
drop policy if exists "clients_select_authenticated" on public.clients;
create policy "clients_select_authenticated" on public.clients for select to authenticated using (true);
drop policy if exists "client_addresses_select_authenticated" on public.client_addresses;
create policy "client_addresses_select_authenticated" on public.client_addresses for select to authenticated using (true);
drop policy if exists "conversations_select_authenticated" on public.conversations;
create policy "conversations_select_authenticated" on public.conversations for select to authenticated using (true);
drop policy if exists "messages_select_authenticated" on public.messages;
create policy "messages_select_authenticated" on public.messages for select to authenticated using (true);
drop policy if exists "call_events_select_authenticated" on public.call_events;
create policy "call_events_select_authenticated" on public.call_events for select to authenticated using (true);
drop policy if exists "events_select_authenticated" on public.events;
create policy "events_select_authenticated" on public.events for select to authenticated using (true);
drop policy if exists "event_services_select_authenticated" on public.event_services;
create policy "event_services_select_authenticated" on public.event_services for select to authenticated using (true);
drop policy if exists "event_assignments_select_authenticated" on public.event_assignments;
create policy "event_assignments_select_authenticated" on public.event_assignments for select to authenticated using (true);
drop policy if exists "tasks_select_authenticated" on public.tasks;
create policy "tasks_select_authenticated" on public.tasks for select to authenticated using (true);
drop policy if exists "event_notes_select_authenticated" on public.event_notes;
create policy "event_notes_select_authenticated" on public.event_notes for select to authenticated using (true);
drop policy if exists "ai_extractions_select_authenticated" on public.ai_extractions;
create policy "ai_extractions_select_authenticated" on public.ai_extractions for select to authenticated using (true);
drop policy if exists "ai_actions_select_authenticated" on public.ai_actions;
create policy "ai_actions_select_authenticated" on public.ai_actions for select to authenticated using (true);
drop policy if exists "whatsapp_sessions_select_authenticated" on public.whatsapp_sessions;
create policy "whatsapp_sessions_select_authenticated" on public.whatsapp_sessions for select to authenticated using (true);

drop policy if exists "employees_write_admin_supervisor" on public.employees;
create policy "employees_write_admin_supervisor" on public.employees for all to authenticated using (public.current_app_role() in ('admin', 'supervisor')) with check (public.current_app_role() in ('admin', 'supervisor'));
drop policy if exists "employee_skills_write_admin_supervisor" on public.employee_skills;
create policy "employee_skills_write_admin_supervisor" on public.employee_skills for all to authenticated using (public.current_app_role() in ('admin', 'supervisor')) with check (public.current_app_role() in ('admin', 'supervisor'));
drop policy if exists "employee_availability_write_admin_supervisor" on public.employee_availability;
create policy "employee_availability_write_admin_supervisor" on public.employee_availability for all to authenticated using (public.current_app_role() in ('admin', 'supervisor')) with check (public.current_app_role() in ('admin', 'supervisor'));
drop policy if exists "clients_write_authenticated" on public.clients;
create policy "clients_write_authenticated" on public.clients for all to authenticated using (true) with check (true);
drop policy if exists "client_addresses_write_authenticated" on public.client_addresses;
create policy "client_addresses_write_authenticated" on public.client_addresses for all to authenticated using (true) with check (true);
drop policy if exists "conversations_write_authenticated" on public.conversations;
create policy "conversations_write_authenticated" on public.conversations for all to authenticated using (true) with check (true);
drop policy if exists "messages_insert_authenticated" on public.messages;
create policy "messages_insert_authenticated" on public.messages for insert to authenticated with check (true);
drop policy if exists "events_write_authenticated" on public.events;
create policy "events_write_authenticated" on public.events for all to authenticated using (true) with check (true);
drop policy if exists "event_services_write_authenticated" on public.event_services;
create policy "event_services_write_authenticated" on public.event_services for all to authenticated using (true) with check (true);
drop policy if exists "event_assignments_write_authenticated" on public.event_assignments;
create policy "event_assignments_write_authenticated" on public.event_assignments for all to authenticated using (true) with check (true);
drop policy if exists "tasks_write_authenticated" on public.tasks;
create policy "tasks_write_authenticated" on public.tasks for all to authenticated using (true) with check (true);
drop policy if exists "event_notes_write_authenticated" on public.event_notes;
create policy "event_notes_write_authenticated" on public.event_notes for all to authenticated using (true) with check (true);
