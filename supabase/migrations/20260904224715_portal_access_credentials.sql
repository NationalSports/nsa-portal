-- Staged coach-portal credential separation.
--
-- This migration deliberately keeps every existing ?portal=<alpha_tag> link
-- working. It stores only a domain-separated SHA-256 digest of each legacy tag;
-- future 256-bit opaque tokens use a separate digest domain. Token issuance,
-- link replacement, and legacy revocation are explicit later operations. No
-- customer alpha_tag is changed or deleted here.

create table if not exists public.portal_access_credentials (
  id uuid primary key default gen_random_uuid(),
  customer_id text not null references public.customers(id) on delete cascade,
  credential_hash text not null unique
    check (credential_hash ~ '^[0-9a-f]{64}$'),
  credential_kind text not null
    check (credential_kind in ('legacy_alpha_tag', 'token')),
  label text,
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  disabled_at timestamptz,
  replaced_by uuid references public.portal_access_credentials(id) on delete set null,
  check (expires_at is null or expires_at > created_at)
);

create index if not exists portal_access_credentials_customer_active_idx
  on public.portal_access_credentials(customer_id)
  where disabled_at is null;

comment on table public.portal_access_credentials is
  'Hash-only coach portal bearer credentials. Never store or log plaintext tokens.';
comment on column public.portal_access_credentials.credential_kind is
  'legacy_alpha_tag preserves old links during rotation; token is an independently generated opaque secret.';

alter table public.portal_access_credentials enable row level security;
revoke all on public.portal_access_credentials from public, anon, authenticated;
grant select, insert, update, delete on public.portal_access_credentials to service_role;

-- The historical portal gate is case-insensitive after trimming. Abort instead
-- of silently assigning an ambiguous credential if production contains a
-- normalized collision; an operator must resolve that data explicitly.
do $$
declare
  duplicate_tags text;
begin
  select string_agg(tag, ', ' order by tag) into duplicate_tags
  from (
    select lower(btrim(alpha_tag)) as tag
    from public.customers
    where nullif(btrim(alpha_tag), '') is not null
    group by lower(btrim(alpha_tag))
    having count(*) > 1
  ) duplicates;

  if duplicate_tags is not null then
    raise exception 'portal credential backfill blocked by duplicate normalized alpha_tag(s): %', duplicate_tags;
  end if;
end $$;

insert into public.portal_access_credentials (
  customer_id, credential_hash, credential_kind, label
)
select
  c.id,
  encode(sha256(convert_to('portal-legacy-v1:' || lower(btrim(c.alpha_tag)), 'UTF8')), 'hex'),
  'legacy_alpha_tag',
  'Legacy portal link'
from public.customers c
where nullif(btrim(c.alpha_tag), '') is not null
on conflict (credential_hash) do nothing;

do $$
declare
  missing_customers text;
begin
  select string_agg(c.id, ', ' order by c.id) into missing_customers
  from public.customers c
  where nullif(btrim(c.alpha_tag), '') is not null
    and not exists (
      select 1
      from public.portal_access_credentials pac
      where pac.customer_id = c.id
        and pac.credential_kind = 'legacy_alpha_tag'
        and pac.credential_hash = encode(sha256(convert_to(
          'portal-legacy-v1:' || lower(btrim(c.alpha_tag)), 'UTF8'
        )), 'hex')
        and pac.disabled_at is null
    );

  if missing_customers is not null then
    raise exception 'portal credential backfill incomplete for customer(s): %', missing_customers;
  end if;
end $$;
