-- Server-side hourly QBO sales automation foundation.
--
-- This migration intentionally starts in read-only mode. The scheduler is live,
-- but customer/invoice/payment writes require an explicit phase change after the
-- scheduled read-only evidence is reviewed. Purchasing and all other QBO domains
-- are outside this schema and cannot be enabled here.

create table public.qbo_sales_settings (
  company_key text primary key check (company_key = 'national'),
  realm_id text not null check (realm_id ~ '^[0-9]+$'),
  expected_company_name text not null,
  background_enabled boolean not null default true,
  kill_switch boolean not null default false,
  writes_enabled boolean not null default false,
  phase text not null default 'read_only'
    check (phase in ('read_only','customer_canary','invoice_canary','payment_canary','bounded','hourly')),
  blank_terms_default text not null default 'net30',
  customer_batch_limit integer not null default 25 check (customer_batch_limit between 1 and 100),
  invoice_batch_limit integer not null default 25 check (invoice_batch_limit between 1 and 100),
  payment_batch_limit integer not null default 25 check (payment_batch_limit between 1 and 100),
  canary_customer_source_id text,
  canary_invoice_source_id text,
  canary_payment_source_id text,
  continuation_cursor jsonb not null default '{}'::jsonb,
  browser_runner_disabled boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by text not null default 'migration'
);

comment on table public.qbo_sales_settings is
  'Service-only kill switch, rollout phase, bounded batch sizes, and continuation state for QBO sales automation.';

insert into public.qbo_sales_settings (
  company_key, realm_id, expected_company_name, background_enabled,
  kill_switch, writes_enabled, phase, browser_runner_disabled
) values (
  'national', '9341456492604246', 'National Sports Apparel LLC', true,
  false, false, 'read_only', true
);

create table public.qbo_sales_runs (
  id uuid primary key default gen_random_uuid(),
  company_key text not null references public.qbo_sales_settings(company_key),
  realm_id text not null check (realm_id ~ '^[0-9]+$'),
  trigger_type text not null check (trigger_type in ('scheduled','manual','retry')),
  phase text not null,
  mode text not null check (mode in ('read_only','write')),
  status text not null check (status in ('running','completed','needs_review','blocked','failed','skipped','abandoned')),
  deployment_id text,
  source_cutoff timestamptz not null,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  lease_token uuid,
  lease_expires_at timestamptz,
  continuation_cursor jsonb not null default '{}'::jsonb,
  counters jsonb not null default '{}'::jsonb,
  qbo_ids jsonb not null default '{}'::jsonb,
  summary jsonb not null default '{}'::jsonb,
  error_code text,
  error_message text,
  check ((status = 'running') = (completed_at is null)),
  check ((status = 'running') = (lease_token is not null and lease_expires_at is not null))
);

create unique index qbo_sales_one_running
  on public.qbo_sales_runs(company_key) where status = 'running';
create index qbo_sales_run_history
  on public.qbo_sales_runs(company_key, started_at desc);

create table public.qbo_sales_run_manifest (
  id bigint generated always as identity primary key,
  run_id uuid not null references public.qbo_sales_runs(id),
  sequence_no integer not null,
  entity_type text not null check (entity_type in ('configuration','customer','invoice','payment')),
  source_id text not null,
  action text not null,
  result text not null,
  qbo_id text,
  evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (run_id, sequence_no)
);

comment on table public.qbo_sales_run_manifest is
  'Append-only sanitized per-record evidence for every scheduled/manual/retry sales run.';

create table public.qbo_sales_manual_reviews (
  id uuid primary key default gen_random_uuid(),
  company_key text not null references public.qbo_sales_settings(company_key),
  realm_id text not null,
  entity_type text not null check (entity_type in ('configuration','customer','invoice','payment')),
  source_id text not null,
  reason_code text not null,
  status text not null default 'open' check (status in ('open','resolved','dismissed')),
  evidence jsonb not null default '{}'::jsonb,
  first_seen_run_id uuid not null references public.qbo_sales_runs(id),
  last_seen_run_id uuid not null references public.qbo_sales_runs(id),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by text,
  resolution_note text,
  unique (company_key, entity_type, source_id, reason_code)
);

create index qbo_sales_manual_review_open
  on public.qbo_sales_manual_reviews(company_key, last_seen_at desc)
  where status = 'open';
create index qbo_sales_manual_review_first_run
  on public.qbo_sales_manual_reviews(first_seen_run_id);
create index qbo_sales_manual_review_last_run
  on public.qbo_sales_manual_reviews(last_seen_run_id);

create table public.qbo_sales_source_claims (
  realm_id text not null,
  source_type text not null check (source_type in ('customer','payment')),
  source_id text not null,
  claim_token uuid not null,
  run_id uuid references public.qbo_sales_runs(id),
  claimed_at timestamptz not null default now(),
  expires_at timestamptz not null,
  primary key (realm_id, source_type, source_id)
);

create index qbo_sales_source_claims_run
  on public.qbo_sales_source_claims(run_id);

create table public.qbo_oauth_refresh_claims (
  company_key text primary key check (company_key = 'national'),
  claim_token uuid not null,
  run_id uuid references public.qbo_sales_runs(id),
  claimed_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create index qbo_oauth_refresh_claims_run
  on public.qbo_oauth_refresh_claims(run_id);

comment on table public.qbo_oauth_refresh_claims is
  'Short service-only lease preventing concurrent Intuit refresh-token rotation.';

alter table public.qbo_sales_settings enable row level security;
alter table public.qbo_sales_runs enable row level security;
alter table public.qbo_sales_run_manifest enable row level security;
alter table public.qbo_sales_manual_reviews enable row level security;
alter table public.qbo_sales_source_claims enable row level security;
alter table public.qbo_oauth_refresh_claims enable row level security;

revoke all on public.qbo_sales_settings from public, anon, authenticated;
revoke all on public.qbo_sales_runs from public, anon, authenticated;
revoke all on public.qbo_sales_run_manifest from public, anon, authenticated;
revoke all on public.qbo_sales_manual_reviews from public, anon, authenticated;
revoke all on public.qbo_sales_source_claims from public, anon, authenticated;
revoke all on public.qbo_oauth_refresh_claims from public, anon, authenticated;

grant select, insert, update on public.qbo_sales_settings to service_role;
grant select, insert, update on public.qbo_sales_runs to service_role;
grant select, insert on public.qbo_sales_run_manifest to service_role;
grant usage, select on sequence public.qbo_sales_run_manifest_id_seq to service_role;
grant select, insert, update on public.qbo_sales_manual_reviews to service_role;
grant select, insert, update, delete on public.qbo_sales_source_claims to service_role;
grant select, insert, update, delete on public.qbo_oauth_refresh_claims to service_role;

create function public.qbo_deny_manifest_mutation()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  raise exception 'QBO sales run manifests are append-only';
end;
$$;

create trigger qbo_sales_manifest_append_only
before update or delete on public.qbo_sales_run_manifest
for each row execute function public.qbo_deny_manifest_mutation();

revoke all on function public.qbo_deny_manifest_mutation() from public, anon, authenticated;
grant execute on function public.qbo_deny_manifest_mutation() to service_role;

create function public.acquire_qbo_sales_run(
  p_trigger_type text,
  p_deployment_id text,
  p_source_cutoff timestamptz,
  p_lease_seconds integer default 840,
  p_force_read_only boolean default false
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_settings public.qbo_sales_settings%rowtype;
  v_existing uuid;
  v_run_id uuid := gen_random_uuid();
  v_token uuid := gen_random_uuid();
  v_reason text;
begin
  if coalesce(auth.jwt()->>'role','') <> 'service_role' then
    raise exception 'Service role required';
  end if;
  if p_trigger_type not in ('scheduled','manual','retry') then
    raise exception 'Invalid sales-run trigger';
  end if;
  if p_lease_seconds < 60 or p_lease_seconds > 900 then
    raise exception 'Invalid sales-run lease';
  end if;

  select * into v_settings from public.qbo_sales_settings
   where company_key = 'national' for update;
  if not found then raise exception 'QBO sales settings missing'; end if;

  update public.qbo_sales_runs
     set status = 'abandoned', completed_at = now(),
         lease_token = null, lease_expires_at = null,
         error_code = 'lease_expired',
         error_message = 'Previous server run exceeded its lease and was abandoned.'
   where company_key = 'national' and status = 'running' and lease_expires_at <= now();

  select id into v_existing from public.qbo_sales_runs
   where company_key = 'national' and status = 'running' and lease_expires_at > now()
   order by started_at desc limit 1;
  if v_existing is not null then
    insert into public.qbo_sales_runs (
      id, company_key, realm_id, trigger_type, phase, mode, status,
      deployment_id, source_cutoff, completed_at, summary
    ) values (
      v_run_id, 'national', v_settings.realm_id, p_trigger_type, v_settings.phase,
      case when v_settings.writes_enabled and not p_force_read_only then 'write' else 'read_only' end,
      'skipped', nullif(p_deployment_id,''), p_source_cutoff, now(),
      jsonb_build_object('reason','run_already_active','active_run_id',v_existing)
    );
    return jsonb_build_object('acquired',false,'run_id',v_run_id,'reason','run_already_active','active_run_id',v_existing);
  end if;

  if not v_settings.background_enabled then v_reason := 'background_disabled'; end if;
  if v_settings.kill_switch then v_reason := 'kill_switch'; end if;
  if v_reason is not null then
    insert into public.qbo_sales_runs (
      id, company_key, realm_id, trigger_type, phase, mode, status,
      deployment_id, source_cutoff, completed_at, summary
    ) values (
      v_run_id, 'national', v_settings.realm_id, p_trigger_type, v_settings.phase,
      case when v_settings.writes_enabled and not p_force_read_only then 'write' else 'read_only' end,
      'skipped', nullif(p_deployment_id,''), p_source_cutoff, now(),
      jsonb_build_object('reason',v_reason)
    );
    return jsonb_build_object('acquired',false,'run_id',v_run_id,'reason',v_reason);
  end if;

  insert into public.qbo_sales_runs (
    id, company_key, realm_id, trigger_type, phase, mode, status,
    deployment_id, source_cutoff, lease_token, lease_expires_at
  ) values (
    v_run_id, 'national', v_settings.realm_id, p_trigger_type, v_settings.phase,
    case when v_settings.writes_enabled and not p_force_read_only then 'write' else 'read_only' end,
    'running', nullif(p_deployment_id,''), p_source_cutoff,
    v_token, now() + make_interval(secs => p_lease_seconds)
  );
  return jsonb_build_object('acquired',true,'run_id',v_run_id,'lease_token',v_token,
    'phase',v_settings.phase,'writes_enabled',(v_settings.writes_enabled and not p_force_read_only),
    'realm_id',v_settings.realm_id,'lease_expires_at',now() + make_interval(secs => p_lease_seconds));
end;
$$;

create function public.qbo_sales_source_snapshot(p_source_cutoff timestamptz)
returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'settings', (select to_jsonb(s) from public.qbo_sales_settings s where s.company_key='national'),
    'legacy_config', (select jsonb_build_object(
      'mapping', coalesce(value::jsonb->'mapping','{}'::jsonb),
      'aliases', coalesce(value::jsonb->'custQBAliasApprovals','{}'::jsonb),
      'realm_id', value::jsonb->>'realm_id'
    ) from public.app_state where id='qb_config'),
    'customers', (select coalesce(jsonb_agg(jsonb_build_object(
      'id',c.id,'name',c.name,'alpha_tag',c.alpha_tag,'payment_terms',c.payment_terms,
      'is_active',c.is_active,'billing_address_line1',c.billing_address_line1,
      'billing_address_line2',c.billing_address_line2,'billing_city',c.billing_city,
      'billing_state',c.billing_state,'billing_zip',c.billing_zip,
      'shipping_address_line1',c.shipping_address_line1,'shipping_address_line2',c.shipping_address_line2,
      'shipping_city',c.shipping_city,'shipping_state',c.shipping_state,'shipping_zip',c.shipping_zip,
      'contact_email',(select cc.email from public.customer_contacts cc where cc.customer_id=c.id and nullif(btrim(cc.email),'') is not null order by cc.sort_order,cc.id limit 1),
      'contact_phone',(select cc.phone from public.customer_contacts cc where cc.customer_id=c.id and nullif(btrim(cc.phone),'') is not null order by cc.sort_order,cc.id limit 1),
      'updated_at',c.updated_at
    ) order by c.id),'[]'::jsonb) from public.customers c
      where c.updated_at is null or c.updated_at <= p_source_cutoff),
    'customer_links', (select coalesce(jsonb_object_agg(x.source_id,x.row_value),'{}'::jsonb) from (
      select value::jsonb->>'source_id' source_id, value::jsonb row_value
      from public.app_state
      where left(id,12) = '_qb_link_v1_'
        and value is not null and left(btrim(value),1)='{' and value::jsonb->>'map_key'='custQBMap'
        and value::jsonb->>'realm_id'='9341456492604246' and coalesce((value::jsonb->>'active')::boolean,true)
    ) x),
    'invoice_links', (select coalesce(jsonb_object_agg(x.source_id,x.row_value),'{}'::jsonb) from (
      select value::jsonb->>'source_id' source_id, value::jsonb row_value
      from public.app_state
      where left(id,12) = '_qb_link_v1_'
        and value is not null and left(btrim(value),1)='{' and value::jsonb->>'map_key'='qbInvoiceMap'
        and value::jsonb->>'realm_id'='9341456492604246' and coalesce((value::jsonb->>'active')::boolean,true)
    ) x),
    'payment_links', (select coalesce(jsonb_object_agg(x.source_id,x.row_value),'{}'::jsonb) from (
      select value::jsonb->>'source_id' source_id, value::jsonb row_value
      from public.app_state
      where left(id,12) = '_qb_link_v1_'
        and value is not null and left(btrim(value),1)='{' and value::jsonb->>'map_key'='qbPaymentMap'
        and value::jsonb->>'realm_id'='9341456492604246' and coalesce((value::jsonb->>'active')::boolean,true)
    ) x),
    'invoices', (select coalesce(jsonb_agg(jsonb_build_object(
      'id',i.id,'customer_id',i.customer_id,'so_id',i.so_id,'date',i.date,'due_date',i.due_date,
      'total',i.total,'paid',i.paid,'memo',i.memo,'status',i.status,'qb_invoice_id',i.qb_invoice_id,
      'tax',i.tax,'tax_rate',i.tax_rate,'shipping',i.shipping,'credit_amount',i.credit_amount,
      'created_at',i.created_at,'updated_at',i.updated_at,'deleted_at',i.deleted_at
    ) order by i.id),'[]'::jsonb) from public.invoices i
      where (i.updated_at is null or i.updated_at <= p_source_cutoff)),
    'payments', (select coalesce(jsonb_agg(jsonb_build_object(
      'id',p.id,'invoice_id',p.invoice_id,'amount',p.amount,'method',p.method,
      'ref',p.ref,'date',p.date,'cc_fee',p.cc_fee
    ) order by p.invoice_id,p.date,p.id),'[]'::jsonb) from public.invoice_payments p),
    'sales_orders', (select coalesce(jsonb_object_agg(s.id,jsonb_build_object('id',s.id,'memo',s.memo)),'{}'::jsonb)
      from public.sales_orders s where s.deleted_at is null)
  );
$$;

create function public.renew_qbo_sales_run_lease(
  p_run_id uuid, p_lease_token uuid, p_lease_seconds integer default 840
) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_count integer;
begin
  if coalesce(auth.jwt()->>'role','') <> 'service_role' then raise exception 'Service role required'; end if;
  if p_lease_seconds < 60 or p_lease_seconds > 900 then raise exception 'Invalid sales-run lease'; end if;
  update public.qbo_sales_runs set lease_expires_at = now() + make_interval(secs => p_lease_seconds)
   where id = p_run_id and status = 'running' and lease_token = p_lease_token and lease_expires_at > now();
  get diagnostics v_count = row_count;
  return v_count = 1;
end;
$$;

create function public.finish_qbo_sales_run(
  p_run_id uuid,
  p_lease_token uuid,
  p_status text,
  p_counters jsonb,
  p_qbo_ids jsonb,
  p_summary jsonb,
  p_continuation_cursor jsonb default '{}'::jsonb,
  p_error_code text default null,
  p_error_message text default null
) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_count integer;
begin
  if coalesce(auth.jwt()->>'role','') <> 'service_role' then raise exception 'Service role required'; end if;
  if p_status not in ('completed','needs_review','blocked','failed') then raise exception 'Invalid terminal sales-run status'; end if;
  update public.qbo_sales_runs
     set status = p_status, completed_at = now(), lease_token = null, lease_expires_at = null,
         counters = coalesce(p_counters,'{}'::jsonb), qbo_ids = coalesce(p_qbo_ids,'{}'::jsonb),
         summary = coalesce(p_summary,'{}'::jsonb), continuation_cursor = coalesce(p_continuation_cursor,'{}'::jsonb),
         error_code = nullif(left(coalesce(p_error_code,''),100),''),
         error_message = nullif(left(coalesce(p_error_message,''),500),'')
   where id = p_run_id and status = 'running' and lease_token = p_lease_token;
  get diagnostics v_count = row_count;
  if v_count = 1 then
    update public.qbo_sales_settings
       set continuation_cursor = coalesce(p_continuation_cursor,'{}'::jsonb), updated_at = now(), updated_by = 'qbo-sales-background'
     where company_key = 'national';
  end if;
  return v_count = 1;
end;
$$;

create function public.acquire_qbo_sales_source_claim(
  p_realm_id text, p_source_type text, p_source_id text,
  p_claim_token uuid, p_run_id uuid, p_lease_seconds integer default 300
) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(auth.jwt()->>'role','') <> 'service_role' then raise exception 'Service role required'; end if;
  if p_source_type not in ('customer','payment') then raise exception 'Invalid sales source type'; end if;
  if nullif(btrim(p_realm_id),'') is null or nullif(btrim(p_source_id),'') is null then raise exception 'Realm and source ID required'; end if;
  if p_lease_seconds < 30 or p_lease_seconds > 900 then raise exception 'Invalid source lease'; end if;
  insert into public.qbo_sales_source_claims(realm_id,source_type,source_id,claim_token,run_id,claimed_at,expires_at)
  values (btrim(p_realm_id),p_source_type,btrim(p_source_id),p_claim_token,p_run_id,now(),now()+make_interval(secs=>p_lease_seconds))
  on conflict (realm_id,source_type,source_id) do update
    set claim_token=excluded.claim_token,run_id=excluded.run_id,claimed_at=excluded.claimed_at,expires_at=excluded.expires_at
    where qbo_sales_source_claims.expires_at <= now() or qbo_sales_source_claims.claim_token=excluded.claim_token;
  return exists(select 1 from public.qbo_sales_source_claims where realm_id=btrim(p_realm_id)
    and source_type=p_source_type and source_id=btrim(p_source_id) and claim_token=p_claim_token and expires_at>now());
end;
$$;

create function public.release_qbo_sales_source_claim(
  p_realm_id text, p_source_type text, p_source_id text, p_claim_token uuid
) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_count integer;
begin
  if coalesce(auth.jwt()->>'role','') <> 'service_role' then raise exception 'Service role required'; end if;
  delete from public.qbo_sales_source_claims where realm_id=btrim(p_realm_id)
    and source_type=p_source_type and source_id=btrim(p_source_id) and claim_token=p_claim_token;
  get diagnostics v_count = row_count;
  return v_count = 1;
end;
$$;

create function public.acquire_qbo_oauth_refresh_claim(
  p_company_key text, p_claim_token uuid, p_run_id uuid, p_lease_seconds integer default 60
) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(auth.jwt()->>'role','') <> 'service_role' then raise exception 'Service role required'; end if;
  if p_company_key <> 'national' then raise exception 'Invalid QBO company'; end if;
  if p_lease_seconds < 30 or p_lease_seconds > 120 then raise exception 'Invalid OAuth refresh lease'; end if;
  insert into public.qbo_oauth_refresh_claims(company_key,claim_token,run_id,claimed_at,expires_at)
  values(p_company_key,p_claim_token,p_run_id,now(),now()+make_interval(secs=>p_lease_seconds))
  on conflict(company_key) do update set claim_token=excluded.claim_token,run_id=excluded.run_id,
    claimed_at=excluded.claimed_at,expires_at=excluded.expires_at
    where qbo_oauth_refresh_claims.expires_at<=now() or qbo_oauth_refresh_claims.claim_token=excluded.claim_token;
  return exists(select 1 from public.qbo_oauth_refresh_claims where company_key=p_company_key
    and claim_token=p_claim_token and expires_at>now());
end;
$$;

create function public.release_qbo_oauth_refresh_claim(
  p_company_key text, p_claim_token uuid
) returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_count integer;
begin
  if coalesce(auth.jwt()->>'role','') <> 'service_role' then raise exception 'Service role required'; end if;
  delete from public.qbo_oauth_refresh_claims where company_key=p_company_key and claim_token=p_claim_token;
  get diagnostics v_count = row_count;
  return v_count = 1;
end;
$$;

revoke all on function public.acquire_qbo_sales_run(text,text,timestamptz,integer,boolean) from public, anon, authenticated;
revoke all on function public.qbo_sales_source_snapshot(timestamptz) from public, anon, authenticated;
revoke all on function public.renew_qbo_sales_run_lease(uuid,uuid,integer) from public, anon, authenticated;
revoke all on function public.finish_qbo_sales_run(uuid,uuid,text,jsonb,jsonb,jsonb,jsonb,text,text) from public, anon, authenticated;
revoke all on function public.acquire_qbo_sales_source_claim(text,text,text,uuid,uuid,integer) from public, anon, authenticated;
revoke all on function public.release_qbo_sales_source_claim(text,text,text,uuid) from public, anon, authenticated;
revoke all on function public.acquire_qbo_oauth_refresh_claim(text,uuid,uuid,integer) from public, anon, authenticated;
revoke all on function public.release_qbo_oauth_refresh_claim(text,uuid) from public, anon, authenticated;

grant execute on function public.acquire_qbo_sales_run(text,text,timestamptz,integer,boolean) to service_role;
grant execute on function public.qbo_sales_source_snapshot(timestamptz) to service_role;
grant execute on function public.renew_qbo_sales_run_lease(uuid,uuid,integer) to service_role;
grant execute on function public.finish_qbo_sales_run(uuid,uuid,text,jsonb,jsonb,jsonb,jsonb,text,text) to service_role;
grant execute on function public.acquire_qbo_sales_source_claim(text,text,text,uuid,uuid,integer) to service_role;
grant execute on function public.release_qbo_sales_source_claim(text,text,text,uuid) to service_role;
grant execute on function public.acquire_qbo_oauth_refresh_claim(text,uuid,uuid,integer) to service_role;
grant execute on function public.release_qbo_oauth_refresh_claim(text,uuid) to service_role;

-- Mark the browser writer off in the legacy config while leaving the user's
-- selected hourly mode visible. Current clients use these flags to become a
-- status/configuration surface; older clients still fail closed on their stale
-- preflight/manifests and cannot overlap the server lease-protected writer.
update public.app_state
   set value = (coalesce(nullif(value,''),'{}')::jsonb || jsonb_build_object(
     'backgroundSalesAutomation', true,
     'browserSalesRunnerDisabled', true
   ))::text,
       version = version + 1,
       updated_at = now()
 where id = 'qb_config';

-- Invoke the JWT-protected Edge Function with the existing service-role Vault
-- secret. The function independently requires a service-role token for
-- scheduled triggers. Writes remain disabled by qbo_sales_settings.
select cron.unschedule(jobid) from cron.job where jobname = 'qbo-sales-hourly';
select cron.schedule(
  'qbo-sales-hourly',
  '17 * * * *',
  $cron$
  select net.http_post(
    url := 'https://hpslkvngulqirmbstlfx.supabase.co/functions/v1/qbo-sales-background',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'Authorization','Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name='service_role_key')
    ),
    body := jsonb_build_object('trigger','scheduled'),
    timeout_milliseconds := 150000
  );
  $cron$
);
