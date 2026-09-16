-- One live lease per immutable source invoice. The QBO API call cannot be held
-- inside a database transaction, so a short durable lease closes the gap
-- between duplicate preflight and create across simultaneous browser/server runs.
create table if not exists public.qbo_invoice_sync_claims (
  realm_id text not null,
  source_invoice_id text not null,
  claim_token uuid not null,
  claimed_by uuid,
  claimed_at timestamptz not null default now(),
  expires_at timestamptz not null,
  primary key (realm_id, source_invoice_id)
);

alter table public.qbo_invoice_sync_claims enable row level security;
revoke all on public.qbo_invoice_sync_claims from public, anon, authenticated;

create or replace function public.acquire_qbo_invoice_sync_claim(
  p_realm_id text,
  p_source_invoice_id text,
  p_claim_token uuid,
  p_lease_seconds integer default 300
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_allowed boolean;
begin
  select coalesce(auth.jwt()->>'role','') = 'service_role' or exists (
    select 1 from public.team_members tm
     where tm.auth_id = auth.uid()
       and tm.is_active is not false
       and tm.role in ('admin','super_admin','accounting')
  ) into v_allowed;
  if not v_allowed then raise exception 'Accounting or admin role required'; end if;
  if nullif(btrim(p_realm_id),'') is null or nullif(btrim(p_source_invoice_id),'') is null then
    raise exception 'Realm and immutable source invoice ID are required';
  end if;
  if p_lease_seconds < 30 or p_lease_seconds > 900 then raise exception 'Invalid invoice-sync lease'; end if;

  insert into public.qbo_invoice_sync_claims
    (realm_id, source_invoice_id, claim_token, claimed_by, claimed_at, expires_at)
  values
    (btrim(p_realm_id), btrim(p_source_invoice_id), p_claim_token, auth.uid(), now(), now() + make_interval(secs => p_lease_seconds))
  on conflict (realm_id, source_invoice_id) do update
     set claim_token = excluded.claim_token,
         claimed_by = excluded.claimed_by,
         claimed_at = excluded.claimed_at,
         expires_at = excluded.expires_at
   where qbo_invoice_sync_claims.expires_at <= now()
      or qbo_invoice_sync_claims.claim_token = excluded.claim_token;

  return exists (
    select 1 from public.qbo_invoice_sync_claims
     where realm_id = btrim(p_realm_id)
       and source_invoice_id = btrim(p_source_invoice_id)
       and claim_token = p_claim_token
       and expires_at > now()
  );
end;
$$;

create or replace function public.release_qbo_invoice_sync_claim(
  p_realm_id text,
  p_source_invoice_id text,
  p_claim_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_allowed boolean;
  v_count integer;
begin
  select coalesce(auth.jwt()->>'role','') = 'service_role' or exists (
    select 1 from public.team_members tm
     where tm.auth_id = auth.uid()
       and tm.is_active is not false
       and tm.role in ('admin','super_admin','accounting')
  ) into v_allowed;
  if not v_allowed then raise exception 'Accounting or admin role required'; end if;

  delete from public.qbo_invoice_sync_claims
   where realm_id = btrim(p_realm_id)
     and source_invoice_id = btrim(p_source_invoice_id)
     and claim_token = p_claim_token;
  get diagnostics v_count = row_count;
  return v_count = 1;
end;
$$;

revoke all on function public.acquire_qbo_invoice_sync_claim(text,text,uuid,integer) from public, anon, authenticated, service_role;
revoke all on function public.release_qbo_invoice_sync_claim(text,text,uuid) from public, anon, authenticated, service_role;
grant execute on function public.acquire_qbo_invoice_sync_claim(text,text,uuid,integer) to authenticated;
grant execute on function public.release_qbo_invoice_sync_claim(text,text,uuid) to authenticated;
grant execute on function public.acquire_qbo_invoice_sync_claim(text,text,uuid,integer) to service_role;
grant execute on function public.release_qbo_invoice_sync_claim(text,text,uuid) to service_role;

comment on table public.qbo_invoice_sync_claims is
  'Short leases preventing simultaneous QBO creates for one immutable Portal/NetSuite invoice.';
