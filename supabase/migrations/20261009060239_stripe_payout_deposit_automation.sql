-- Separate opt-in for settlement: existing invoice/payment enablement must not
-- silently authorize historical bank deposits. Service role owns this ledger.
alter table public.qbo_sales_settings
  add column stripe_payouts_enabled boolean not null default false,
  add column stripe_payout_writes_enabled boolean not null default false,
  add column stripe_payout_bank_account_id text,
  add column stripe_payout_fee_account_id text,
  add column stripe_payout_start_date date,
  add column stripe_payout_canary_id text;

create table public.qbo_stripe_payout_postings (
  stripe_payout_id text primary key references public.stripe_payouts(stripe_payout_id),
  realm_id text not null,
  state text not null check(state in ('proposed','held','submitting','unknown','posted')),
  payload jsonb,
  source_hash text,
  request_id text,
  qbo_deposit_id text,
  error_code text,
  run_id uuid references public.qbo_sales_runs(id),
  updated_at timestamptz not null default now(),
  posted_at timestamptz,
  check(state <> 'posted' or (qbo_deposit_id is not null and posted_at is not null))
);
create unique index qbo_stripe_payout_deposit_unique
  on public.qbo_stripe_payout_postings(realm_id,qbo_deposit_id) where qbo_deposit_id is not null;
alter table public.qbo_stripe_payout_postings enable row level security;
revoke all on public.qbo_stripe_payout_postings from public,anon,authenticated;
grant select,insert,update on public.qbo_stripe_payout_postings to service_role;

-- Never reclaim submitting/unknown automatically: a timeout may have happened
-- after QBO accepted the deposit. The worker can recover by verified read-back.
create function public.claim_qbo_stripe_payout(
  p_payout_id text,p_run_id uuid,p_lease_token uuid,p_payload jsonb,p_source_hash text,p_request_id text
) returns boolean language plpgsql security definer set search_path='' as $$
declare r public.qbo_sales_runs; s public.qbo_sales_settings; p public.stripe_payouts; n integer;
begin
  select * into r from public.qbo_sales_runs where id=p_run_id for update;
  if not found or r.status<>'running' or r.mode<>'write' or r.lease_token is distinct from p_lease_token
     or r.lease_expires_at<=now() then return false; end if;
  select * into s from public.qbo_sales_settings where company_key=r.company_key for share;
  if not s.background_enabled or s.kill_switch or not s.writes_enabled
    or s.realm_id<>r.realm_id or s.phase not in ('bounded','hourly') or not s.stripe_payouts_enabled or not s.stripe_payout_writes_enabled
    or s.stripe_payout_start_date is null or s.stripe_payout_bank_account_id is null
    or s.stripe_payout_fee_account_id is null then return false; end if;
  select * into p from public.stripe_payouts where stripe_payout_id=p_payout_id for update;
  if not found or p.qbo_deposit_id is not null or p.status<>'paid' or not p.automatic
    or p.currency<>'usd' or p.reconciliation_status<>'exact'
    or p.arrival_date is null or p.arrival_date<s.stripe_payout_start_date
    or (nullif(s.stripe_payout_canary_id,'') is not null and s.stripe_payout_canary_id<>p_payout_id)
    or p_payload->'DepositToAccountRef'->>'value' is distinct from s.stripe_payout_bank_account_id
    or p_payload->>'TxnDate' is distinct from p.arrival_date::text
    or p_source_hash is null or p_request_id is null then return false; end if;
  if exists(select 1 from jsonb_array_elements(coalesce(p_payload->'Line','[]'::jsonb)) l
    where l->>'DetailType'='DepositLineDetail'
      and l->'DepositLineDetail'->'AccountRef'->>'value' is distinct from s.stripe_payout_fee_account_id)
    then return false; end if;
  insert into public.qbo_stripe_payout_postings(stripe_payout_id,realm_id,state,payload,source_hash,request_id,run_id)
    values(p_payout_id,r.realm_id,'submitting',p_payload,p_source_hash,p_request_id,p_run_id)
    on conflict(stripe_payout_id) do update set state='submitting',payload=excluded.payload,
      source_hash=excluded.source_hash,request_id=excluded.request_id,run_id=excluded.run_id,error_code=null,updated_at=now()
    where qbo_stripe_payout_postings.state in ('proposed','held') and qbo_stripe_payout_postings.realm_id=excluded.realm_id;
  get diagnostics n=row_count;
  return n=1;
end $$;
revoke all on function public.claim_qbo_stripe_payout(text,uuid,uuid,jsonb,text,text) from public,anon,authenticated;
grant execute on function public.claim_qbo_stripe_payout(text,uuid,uuid,jsonb,text,text) to service_role;
