-- Supabase / Postgres
create extension if not exists pgcrypto;

-- updated_at helper
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- 1) Cererea principală de onboarding
create table if not exists public.collaborator_applications (
  id uuid primary key default gen_random_uuid(),

  auth_user_id uuid null references auth.users(id) on delete set null,

  declared_full_name text,
  declared_email text,
  declared_phone_e164 text,
  invite_code text,

  onboarding_status text not null default 'draft' check (
    onboarding_status in (
      'draft',
      'submitted',
      'ai_rejected',
      'needs_reupload',
      'ready_for_admin_review',
      'approved',
      'rejected'
    )
  ),

  ai_decision text null check (
    ai_decision in (
      'ai_rejected',
      'needs_reupload',
      'ready_for_admin_review'
    )
  ),

  admin_decision text null check (
    admin_decision in (
      'approved',
      'rejected',
      'needs_reupload'
    )
  ),

  ai_score numeric(5,2) null,
  risk_score numeric(5,2) null,

  latest_ai_review_id uuid null,
  latest_admin_review_id uuid null,

  admin_approved_by_email text null,
  admin_notes text null,

  submitted_at timestamptz null,
  approved_at timestamptz null,
  rejected_at timestamptz null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_collaborator_applications_updated_at
before update on public.collaborator_applications
for each row execute function public.set_updated_at();

create index if not exists idx_collab_apps_status
  on public.collaborator_applications (onboarding_status, created_at desc);

create index if not exists idx_collab_apps_email
  on public.collaborator_applications (declared_email);

create index if not exists idx_collab_apps_phone
  on public.collaborator_applications (declared_phone_e164);

create unique index if not exists uq_collab_apps_one_open_per_user
  on public.collaborator_applications (auth_user_id)
  where onboarding_status in ('draft', 'submitted', 'needs_reupload', 'ready_for_admin_review');


-- 2) Documente și fișiere încărcate
-- Fisierele reale stau în Storage bucket, aici păstrăm doar metadata + ce a extras AI-ul.
create table if not exists public.collaborator_documents (
  id uuid primary key default gen_random_uuid(),

  application_id uuid not null
    references public.collaborator_applications(id)
    on delete cascade,

  document_kind text not null check (
    document_kind in (
      'id_front',
      'id_back',
      'selfie',
      'liveness_video'
    )
  ),

  storage_bucket text not null default 'collaborator_kyc',
  storage_path text not null,

  mime_type text,
  byte_size bigint,
  sha256 text,

  width_px integer,
  height_px integer,
  duration_ms integer,

  upload_status text not null default 'uploaded' check (
    upload_status in ('uploaded', 'replaced', 'deleted')
  ),

  quality_status text null check (
    quality_status in ('unknown', 'ok', 'blurry', 'cropped', 'dark', 'invalid')
  ),

  extracted_text text null,
  extracted_data_json jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger trg_collaborator_documents_updated_at
before update on public.collaborator_documents
for each row execute function public.set_updated_at();

create index if not exists idx_collab_docs_app
  on public.collaborator_documents (application_id, document_kind);

create unique index if not exists uq_collab_docs_one_active_kind
  on public.collaborator_documents (application_id, document_kind, upload_status)
  where upload_status = 'uploaded';


-- 3) Rezultatul rularilor AI
-- Aici salvezi tot ce "vede" AI-ul: calitate, risc, document, selfie, liveness, comparație.
create table if not exists public.collaborator_ai_reviews (
  id uuid primary key default gen_random_uuid(),

  application_id uuid not null
    references public.collaborator_applications(id)
    on delete cascade,

  model_name text,
  model_version text,
  pipeline_version text,

  ai_status text not null check (
    ai_status in (
      'ai_rejected',
      'needs_reupload',
      'ready_for_admin_review'
    )
  ),

  confidence_score numeric(5,2) null,
  risk_score numeric(5,2) null,

  risk_flags jsonb not null default '[]'::jsonb,
  quality_flags jsonb not null default '[]'::jsonb,

  document_summary_json jsonb not null default '{}'::jsonb,
  selfie_summary_json jsonb not null default '{}'::jsonb,
  liveness_summary_json jsonb not null default '{}'::jsonb,

  face_present_in_id boolean,
  face_present_in_selfie boolean,
  single_person_in_selfie boolean,
  document_expired boolean,

  -- dacă vrei prefiltrare automată pe asemănare, aici salvezi scorul,
  -- dar decizia finală rămâne la admin
  face_match_score numeric(5,2) null,
  liveness_score numeric(5,2) null,

  extracted_full_name text null,
  extracted_document_number text null,
  extracted_birth_date date null,
  extracted_expiry_date date null,

  review_notes text null,

  created_at timestamptz not null default now()
);

create index if not exists idx_collab_ai_reviews_app
  on public.collaborator_ai_reviews (application_id, created_at desc);


-- 4) Deciziile tale din panoul de admin
create table if not exists public.collaborator_admin_reviews (
  id uuid primary key default gen_random_uuid(),

  application_id uuid not null
    references public.collaborator_applications(id)
    on delete cascade,

  reviewer_email text not null,
  decision text not null check (
    decision in ('approved', 'rejected', 'needs_reupload')
  ),

  reason_code text null,
  notes text null,

  created_at timestamptz not null default now()
);

create index if not exists idx_collab_admin_reviews_app
  on public.collaborator_admin_reviews (application_id, created_at desc);


-- 5) Audit log complet
create table if not exists public.collaborator_audit_events (
  id uuid primary key default gen_random_uuid(),

  application_id uuid not null
    references public.collaborator_applications(id)
    on delete cascade,

  event_type text not null,
  actor_type text not null check (
    actor_type in ('applicant', 'ai', 'admin', 'system')
  ),

  actor_ref text null,
  event_data_json jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now()
);

create index if not exists idx_collab_audit_app
  on public.collaborator_audit_events (application_id, created_at desc);


-- 6) Legăm latest_ai_review_id și latest_admin_review_id
alter table public.collaborator_applications
  add constraint fk_collab_apps_latest_ai_review
  foreign key (latest_ai_review_id)
  references public.collaborator_ai_reviews(id)
  on delete set null;

alter table public.collaborator_applications
  add constraint fk_collab_apps_latest_admin_review
  foreign key (latest_admin_review_id)
  references public.collaborator_admin_reviews(id)
  on delete set null;
