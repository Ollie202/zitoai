create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.procurement_jobs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  request_text text not null,
  request_payload jsonb not null default '{}'::jsonb,
  normalized_brief jsonb not null default '{}'::jsonb,
  status text not null default 'draft' check (status in ('draft','searching','quoted','awaiting_payment','purchased','delivered','cancelled','failed','disputed')),
  selected_provider text,
  selected_asset_id text,
  selected_asset_snapshot jsonb,
  currency text,
  expected_amount numeric(18,6),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.purchase_records (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  job_id uuid not null references public.procurement_jobs(id) on delete cascade,
  provider text not null,
  provider_order_id text,
  provider_asset_id text,
  payment_reference text,
  checkout_url text,
  amount numeric(18,6),
  currency text,
  status text not null default 'pending' check (status in ('pending','authorized','paid','failed','refunded','cancelled','disputed')),
  purchased_at timestamptz,
  receipt_number text,
  provider_response jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, provider_order_id)
);

create table public.license_records (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  job_id uuid not null references public.procurement_jobs(id) on delete cascade,
  purchase_id uuid references public.purchase_records(id) on delete set null,
  provider text not null,
  provider_license_id text,
  license_name text,
  license_url text,
  license_text text,
  license_sha256 text,
  terms_snapshot jsonb not null default '{}'::jsonb,
  commercial_use boolean,
  attribution_required boolean,
  editorial_only boolean,
  perpetual boolean,
  territory text,
  valid_from timestamptz,
  valid_until timestamptz,
  captured_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table public.evidence_artifacts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  job_id uuid not null references public.procurement_jobs(id) on delete cascade,
  purchase_id uuid references public.purchase_records(id) on delete set null,
  license_id uuid references public.license_records(id) on delete set null,
  artifact_type text not null check (artifact_type in ('receipt','invoice','license_certificate','license_terms','asset_snapshot','payment_proof','provider_response','delivery_manifest','other')),
  storage_bucket text not null default 'license-evidence',
  storage_path text not null,
  original_name text,
  content_type text,
  byte_size bigint,
  sha256 text,
  source_url text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (storage_bucket, storage_path)
);

create table public.provider_connections (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  provider text not null,
  provider_account_id text,
  account_label text,
  scopes text[] not null default '{}',
  status text not null default 'pending' check (status in ('pending','connected','expired','revoked','error')),
  credentials_ref text,
  access_token_ciphertext text,
  refresh_token_ciphertext text,
  expires_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, provider)
);

create table public.audit_events (
  id bigint generated always as identity primary key,
  owner_id uuid references auth.users(id) on delete set null,
  job_id uuid references public.procurement_jobs(id) on delete set null,
  actor_type text not null check (actor_type in ('user','agent','provider','payment_system','system')),
  event_type text not null,
  event_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index procurement_jobs_owner_created_idx on public.procurement_jobs(owner_id, created_at desc);
create index purchase_records_job_idx on public.purchase_records(job_id);
create index license_records_job_idx on public.license_records(job_id);
create index evidence_artifacts_job_idx on public.evidence_artifacts(job_id);
create index audit_events_job_created_idx on public.audit_events(job_id, created_at);

create trigger profiles_updated_at before update on public.profiles
for each row execute function public.set_updated_at();
create trigger procurement_jobs_updated_at before update on public.procurement_jobs
for each row execute function public.set_updated_at();
create trigger purchase_records_updated_at before update on public.purchase_records
for each row execute function public.set_updated_at();
create trigger provider_connections_updated_at before update on public.provider_connections
for each row execute function public.set_updated_at();

alter table public.profiles enable row level security;
alter table public.procurement_jobs enable row level security;
alter table public.purchase_records enable row level security;
alter table public.license_records enable row level security;
alter table public.evidence_artifacts enable row level security;
alter table public.provider_connections enable row level security;
alter table public.audit_events enable row level security;

create policy "profiles_owner_all" on public.profiles for all
using (id = auth.uid()) with check (id = auth.uid());
create policy "jobs_owner_all" on public.procurement_jobs for all
using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "purchases_owner_all" on public.purchase_records for all
using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "licenses_owner_all" on public.license_records for all
using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "evidence_owner_all" on public.evidence_artifacts for all
using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "connections_owner_read" on public.provider_connections for select
using (owner_id = auth.uid());
create policy "audit_owner_read" on public.audit_events for select
using (owner_id = auth.uid());
create policy "audit_owner_insert" on public.audit_events for insert
with check (owner_id = auth.uid());

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'license-evidence',
  'license-evidence',
  false,
  26214400,
  array['application/pdf','application/json','text/plain','text/html','image/png','image/jpeg','image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "evidence_storage_owner_read" on storage.objects for select
using (bucket_id = 'license-evidence' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "evidence_storage_owner_insert" on storage.objects for insert
with check (bucket_id = 'license-evidence' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "evidence_storage_owner_update" on storage.objects for update
using (bucket_id = 'license-evidence' and (storage.foldername(name))[1] = auth.uid()::text)
with check (bucket_id = 'license-evidence' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "evidence_storage_owner_delete" on storage.objects for delete
using (bucket_id = 'license-evidence' and (storage.foldername(name))[1] = auth.uid()::text);

create or replace function public.record_purchase_bundle(
  p_job_id uuid,
  p_purchase jsonb,
  p_license jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_owner uuid := auth.uid();
  v_purchase_id uuid;
  v_license_id uuid;
begin
  if v_owner is null then raise exception 'authentication required'; end if;
  if not exists (
    select 1 from public.procurement_jobs where id = p_job_id and owner_id = v_owner
  ) then raise exception 'procurement not found'; end if;

  insert into public.purchase_records (
    owner_id, job_id, provider, provider_order_id, provider_asset_id,
    payment_reference, checkout_url, amount, currency, status, purchased_at,
    receipt_number, provider_response
  ) values (
    v_owner, p_job_id, p_purchase->>'provider', p_purchase->>'providerOrderId',
    p_purchase->>'providerAssetId', p_purchase->>'paymentReference',
    p_purchase->>'checkoutUrl', nullif(p_purchase->>'amount','')::numeric,
    p_purchase->>'currency', coalesce(p_purchase->>'status','paid'),
    coalesce(nullif(p_purchase->>'purchasedAt','')::timestamptz, now()),
    p_purchase->>'receiptNumber', coalesce(p_purchase->'providerResponse','{}'::jsonb)
  ) returning id into v_purchase_id;

  insert into public.license_records (
    owner_id, job_id, purchase_id, provider, provider_license_id, license_name,
    license_url, license_text, license_sha256, terms_snapshot, commercial_use,
    attribution_required, editorial_only, perpetual, territory, valid_from, valid_until
  ) values (
    v_owner, p_job_id, v_purchase_id, coalesce(p_license->>'provider', p_purchase->>'provider'),
    p_license->>'providerLicenseId', p_license->>'licenseName', p_license->>'licenseUrl',
    p_license->>'licenseText', p_license->>'licenseSha256',
    coalesce(p_license->'termsSnapshot','{}'::jsonb),
    nullif(p_license->>'commercialUse','')::boolean,
    nullif(p_license->>'attributionRequired','')::boolean,
    nullif(p_license->>'editorialOnly','')::boolean,
    nullif(p_license->>'perpetual','')::boolean,
    p_license->>'territory', nullif(p_license->>'validFrom','')::timestamptz,
    nullif(p_license->>'validUntil','')::timestamptz
  ) returning id into v_license_id;

  update public.procurement_jobs
  set status = 'purchased', selected_provider = p_purchase->>'provider',
      selected_asset_id = p_purchase->>'providerAssetId'
  where id = p_job_id and owner_id = v_owner;

  insert into public.audit_events(owner_id, job_id, actor_type, event_type, event_payload)
  values (v_owner, p_job_id, 'agent', 'purchase_recorded',
    jsonb_build_object('purchaseId', v_purchase_id, 'licenseId', v_license_id));

  return jsonb_build_object('purchaseId', v_purchase_id, 'licenseId', v_license_id);
end;
$$;

grant execute on function public.record_purchase_bundle(uuid, jsonb, jsonb) to authenticated;
