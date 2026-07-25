-- Rep-controlled webstore presentation.
--
-- `presentation_mode` is the rep's draft selection. The storefront reads only
-- `published_presentation_mode`, so changing the draft never changes the live
-- experience until the rep explicitly publishes it.
alter table public.webstores
  add column if not exists presentation_mode text not null default 'standard',
  add column if not exists published_presentation_mode text not null default 'standard',
  add column if not exists presentation_published_at timestamptz,
  add column if not exists presentation_published_by text references public.team_members(id) on delete set null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.webstores'::regclass
      and conname = 'webstores_presentation_mode_check'
  ) then
    alter table public.webstores
      add constraint webstores_presentation_mode_check
      check (presentation_mode in ('standard', 'showcase'));
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.webstores'::regclass
      and conname = 'webstores_published_presentation_mode_check'
  ) then
    alter table public.webstores
      add constraint webstores_published_presentation_mode_check
      check (published_presentation_mode in ('standard', 'showcase'));
  end if;
end $$;

create table if not exists public.webstore_showcase_assets (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.webstores(id) on delete cascade,
  webstore_product_id uuid not null references public.webstore_products(id) on delete cascade,
  product_id text references public.products(id) on delete set null,
  standard_image_url text,
  showcase_image_url text,
  approved_showcase_image_url text,
  status text not null default 'queued'
    check (status in ('queued', 'generating', 'review', 'approved', 'failed')),
  approval_status text not null default 'pending'
    check (approval_status in ('pending', 'approved', 'rejected')),
  fallback_to_standard boolean not null default true,
  provider text,
  provider_model text,
  analysis_provider text,
  analysis_model text,
  generation_request_id uuid,
  provider_job_id text,
  prompt_version text,
  prompt text,
  analysis jsonb not null default '{}'::jsonb,
  qa_result jsonb not null default '{}'::jsonb,
  error_details text,
  reviewed_by text references public.team_members(id) on delete set null,
  reviewed_at timestamptz,
  generation_started_at timestamptz,
  generated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id, webstore_product_id)
);

create index if not exists webstore_showcase_assets_store_status_idx
  on public.webstore_showcase_assets (store_id, status);
create index if not exists webstore_showcase_assets_product_idx
  on public.webstore_showcase_assets (webstore_product_id);

alter table public.webstore_showcase_assets enable row level security;

-- All metadata and state changes go through staff-authenticated Netlify
-- functions. The service role performs those writes; neither shoppers nor
-- browser sessions can query provider prompts, failures, or job metadata.
revoke all on table public.webstore_showcase_assets from anon, authenticated;
grant all on table public.webstore_showcase_assets to service_role;

-- Showcase files are immutable, versioned PNGs. The bucket is public because an
-- approved asset is displayed in the public storefront; only the service role
-- uploads to it, and no storage.objects write policy is granted to browser roles.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'showcase-images',
  'showcase-images',
  true,
  20971520,
  array['image/png', 'image/jpeg', 'image/webp']::text[]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

comment on column public.webstores.presentation_mode is
  'Rep-selected draft presentation; never read directly by the public storefront.';
comment on column public.webstores.published_presentation_mode is
  'Explicitly published presentation read by the public showcase endpoint.';
comment on table public.webstore_showcase_assets is
  'Private generation/review metadata for versioned, permanently stored Showcase images.';
