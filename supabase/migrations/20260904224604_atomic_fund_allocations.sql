-- Promo dollars and account credits are financial ledgers. Replace the former
-- browser-side read/modify/write sequence with one serialized database operation.

begin;

alter table public.sales_orders
  add column if not exists fund_allocation_status text not null default 'posted',
  add column if not exists fund_allocation_error text,
  add column if not exists fund_allocation_updated_at timestamptz;

alter table public.estimates
  add column if not exists fund_allocation_status text not null default 'posted',
  add column if not exists fund_allocation_error text,
  add column if not exists fund_allocation_updated_at timestamptz;

-- Do not infer a repaired balance from incomplete legacy usage history. A
-- counter that differs from its ledger (or is already overdrawn) needs an
-- explicit finance review before this migration can safely allocate money.
do $$
declare
  v_bad_promo integer;
  v_bad_credit integer;
begin
  select count(*) into v_bad_promo
    from public.customer_promo_periods p
   where coalesce(p.allocated, 0) < 0
      or coalesce(p.used, 0) < 0
      or coalesce(p.used, 0) > coalesce(p.allocated, 0) + 0.005
      or abs(coalesce(p.used, 0) - coalesce((
           select sum(coalesce(u.amount, 0))
             from public.customer_promo_usage u
            where u.period_id = p.id
         ), 0)) > 0.005;

  select count(*) into v_bad_credit
    from public.customer_credits c
   where coalesce(c.amount, 0) < 0
      or coalesce(c.used, 0) < 0
      or coalesce(c.used, 0) > coalesce(c.amount, 0) + 0.005
      or abs(coalesce(c.used, 0) - coalesce((
           select sum(coalesce(u.amount, 0))
             from public.customer_credit_usage u
            where u.credit_id = c.id
         ), 0)) > 0.005;

  if v_bad_promo > 0 or v_bad_credit > 0 then
    raise exception 'fund ledger counters need review before migration: % promo period(s), % credit row(s)',
      v_bad_promo, v_bad_credit;
  end if;
end $$;

-- Existing funded documents are trusted only when their usage rows add up to
-- the stored header amounts. Anything else becomes visible and retryable.
update public.estimates e
   set fund_allocation_status = 'pending',
       fund_allocation_error = 'Existing fund usage needs reconciliation'
 where coalesce(e.status, '') <> 'converted'
   and (
     abs(coalesce(e.promo_amount, 0) - coalesce((
       select sum(u.amount) from public.customer_promo_usage u
        where u.estimate_id = e.id and u.so_id is null
     ), 0)) > 0.005
     or abs(coalesce(e.credit_amount, 0) - coalesce((
       select sum(u.amount) from public.customer_credit_usage u
        where u.estimate_id = e.id and u.so_id is null
     ), 0)) > 0.005
   );

update public.sales_orders s
   set fund_allocation_status = 'pending',
       fund_allocation_error = 'Existing fund usage needs reconciliation'
 where (
     abs(coalesce(s.promo_amount, 0) - coalesce((
       select sum(u.amount) from public.customer_promo_usage u where u.so_id = s.id
     ), 0)) > 0.005
     or abs(coalesce(s.credit_amount, 0) - coalesce((
       select sum(u.amount) from public.customer_credit_usage u where u.so_id = s.id
     ), 0)) > 0.005
   );

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'sales_orders_fund_allocation_status_check'
       and conrelid = 'public.sales_orders'::regclass
  ) then
    alter table public.sales_orders
      add constraint sales_orders_fund_allocation_status_check
      check (fund_allocation_status in ('pending', 'posted'));
  end if;
  if not exists (
    select 1 from pg_constraint
     where conname = 'estimates_fund_allocation_status_check'
       and conrelid = 'public.estimates'::regclass
  ) then
    alter table public.estimates
      add constraint estimates_fund_allocation_status_check
      check (fund_allocation_status in ('pending', 'posted'));
  end if;
end $$;

-- One live sales order may own an estimate. This closes the two-tab gap before
-- either tab reaches the idempotent allocation RPC. Fail the migration loudly
-- if historical duplicates need review instead of picking a winner silently.
do $$
begin
  if exists (
    select 1 from public.sales_orders
     where estimate_id is not null and deleted_at is null
     group by estimate_id having count(*) > 1
  ) then
    raise exception 'duplicate live sales orders reference the same estimate; reconcile them before applying atomic fund allocations';
  end if;
end $$;

create unique index if not exists uq_sales_orders_live_estimate
  on public.sales_orders(estimate_id)
  where estimate_id is not null and deleted_at is null;

create index if not exists idx_customer_promo_usage_period_id
  on public.customer_promo_usage(period_id);
create index if not exists idx_customer_promo_usage_so_id
  on public.customer_promo_usage(so_id) where so_id is not null;
create index if not exists idx_customer_credit_usage_credit_id
  on public.customer_credit_usage(credit_id);
create index if not exists idx_customer_credit_usage_so_id
  on public.customer_credit_usage(so_id) where so_id is not null;

create or replace function public.set_document_fund_allocation(
  p_document_type text,
  p_document_id text,
  p_customer_id text,
  p_promo_amount numeric,
  p_credit_amount numeric,
  p_source_estimate_id text default null,
  p_description text default null,
  p_created_by text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_customer public.customers%rowtype;
  v_document_customer_id text;
  v_document_estimate_id text;
  v_promo_owner_id text;
  v_promo numeric(12,2) := round(coalesce(p_promo_amount, 0)::numeric, 2);
  v_credit numeric(12,2) := round(coalesce(p_credit_amount, 0)::numeric, 2);
  v_remaining numeric(12,2);
  v_available numeric(12,2);
  v_take numeric(12,2);
  v_period_start text;
  v_period_end text;
  v_period public.customer_promo_periods%rowtype;
  v_credit_row public.customer_credits%rowtype;
  v_old record;
  v_created_by text;
  v_role text;
  v_old_promo_period_ids text[] := '{}'::text[];
begin
  v_role := coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb->>'role',
    current_setting('request.jwt.claim.role', true),
    '');
  if v_role <> 'service_role' then
    if auth.uid() is null or not public.is_team_member() then
      raise exception 'staff authentication required' using errcode = '42501';
    end if;
  end if;
  if p_document_type not in ('estimate', 'sales_order') then
    raise exception 'document type must be estimate or sales_order' using errcode = '22023';
  end if;
  if nullif(btrim(coalesce(p_document_id, '')), '') is null
     or nullif(btrim(coalesce(p_customer_id, '')), '') is null then
    raise exception 'document id and customer id are required' using errcode = '22023';
  end if;
  if v_promo < 0 or v_credit < 0 then
    raise exception 'fund allocation amounts cannot be negative' using errcode = '22023';
  end if;

  -- Same-document retries replace the prior allocation. The advisory lock also
  -- serializes the first call, before any usage rows exist to row-lock.
  perform pg_advisory_xact_lock(hashtextextended('fund-document:' || p_document_type || ':' || p_document_id, 0));

  if p_document_type = 'estimate' then
    select customer_id into v_document_customer_id
      from public.estimates
     where id = p_document_id
     for update;
  else
    select customer_id, estimate_id into v_document_customer_id, v_document_estimate_id
      from public.sales_orders
     where id = p_document_id
     for update;
  end if;
  if not found then
    raise exception '% % was not found', p_document_type, p_document_id using errcode = 'P0002';
  end if;
  if v_document_customer_id is distinct from p_customer_id then
    raise exception 'document customer does not match allocation customer' using errcode = '22023';
  end if;

  if p_source_estimate_id is not null then
    if p_document_type <> 'sales_order' or v_document_estimate_id is distinct from p_source_estimate_id then
      raise exception 'source estimate does not match the sales order' using errcode = '22023';
    end if;
    perform 1 from public.estimates
     where id = p_source_estimate_id and customer_id = p_customer_id
     for update;
    if not found then
      raise exception 'source estimate was not found for this customer' using errcode = 'P0002';
    end if;
  end if;

  -- Read the family key before taking customer row locks, then acquire the
  -- family advisory lock first. Parent and child calls consequently share one
  -- lock order instead of deadlocking parent-row vs family-lock acquisition.
  select * into v_customer from public.customers where id = p_customer_id;
  if not found then
    raise exception 'allocation customer was not found' using errcode = 'P0002';
  end if;
  v_promo_owner_id := coalesce(v_customer.parent_id, v_customer.id);

  -- All siblings share the parent's promo pool.
  perform pg_advisory_xact_lock(hashtextextended('fund-family:' || v_promo_owner_id, 0));
  perform 1 from public.customers
   where id in (p_customer_id, v_promo_owner_id)
   order by id
   for update;
  select * into v_customer from public.customers where id = p_customer_id;
  if not found then
    raise exception 'allocation customer was not found' using errcode = 'P0002';
  end if;
  if coalesce(v_customer.parent_id, v_customer.id) is distinct from v_promo_owner_id then
    raise exception 'customer promo family changed; retry the allocation' using errcode = '40001';
  end if;
  if v_promo_owner_id <> p_customer_id
     and not exists (select 1 from public.customers where id = v_promo_owner_id) then
    raise exception 'promo parent customer was not found' using errcode = 'P0002';
  end if;

  perform 1 from public.customer_promo_periods p
   where p.customer_id = v_promo_owner_id
   order by p.id
   for update;
  if exists (
    select 1 from public.customer_promo_periods p
     where p.customer_id = v_promo_owner_id
       and (
         coalesce(p.allocated, 0) < 0
         or coalesce(p.used, 0) < 0
         or coalesce(p.used, 0) > coalesce(p.allocated, 0) + 0.005
         or abs(coalesce(p.used, 0) - coalesce((
              select sum(coalesce(u.amount, 0))
                from public.customer_promo_usage u
               where u.period_id = p.id
            ), 0)) > 0.005
       )
  ) then
    raise exception 'promo ledger counters need review for customer %', v_promo_owner_id
      using errcode = 'P0001';
  end if;

  perform 1 from public.customer_credits c
   where c.customer_id = p_customer_id
   order by c.id
   for update;
  if exists (
    select 1 from public.customer_credits c
     where c.customer_id = p_customer_id
       and (
         coalesce(c.amount, 0) < 0
         or coalesce(c.used, 0) < 0
         or coalesce(c.used, 0) > coalesce(c.amount, 0) + 0.005
         or abs(coalesce(c.used, 0) - coalesce((
              select sum(coalesce(u.amount, 0))
                from public.customer_credit_usage u
               where u.credit_id = c.id
            ), 0)) > 0.005
       )
  ) then
    raise exception 'credit ledger counters need review for customer %', p_customer_id
      using errcode = 'P0001';
  end if;

  select tm.id into v_created_by
    from public.team_members tm
   where tm.auth_id = auth.uid()
   limit 1;
  v_created_by := coalesce(v_created_by, nullif(btrim(coalesce(p_created_by, '')), ''), 'System');

  -- Restore this document's prior promo draws (and the source estimate's draw
  -- during conversion), then delete those rows. Repeating the same request is
  -- therefore idempotent and changing an amount applies only the delta.
  perform 1 from public.customer_promo_usage u
   where (p_document_type = 'estimate' and u.estimate_id = p_document_id and u.so_id is null)
      or (p_document_type = 'sales_order' and u.so_id = p_document_id)
      or (p_source_estimate_id is not null and u.estimate_id = p_source_estimate_id and u.so_id is null)
   order by u.id
   for update;
  for v_old in
    select u.period_id, sum(u.amount)::numeric(12,2) as amount
      from public.customer_promo_usage u
     where (p_document_type = 'estimate' and u.estimate_id = p_document_id and u.so_id is null)
        or (p_document_type = 'sales_order' and u.so_id = p_document_id)
        or (p_source_estimate_id is not null and u.estimate_id = p_source_estimate_id and u.so_id is null)
     group by u.period_id
     order by u.period_id
  loop
    v_old_promo_period_ids := array_append(v_old_promo_period_ids, v_old.period_id);
    update public.customer_promo_periods
       set used = round((coalesce(used, 0) - v_old.amount)::numeric, 2)
     where id = v_old.period_id and customer_id = v_promo_owner_id;
    if not found then
      raise exception 'promo usage points outside the customer family';
    end if;
  end loop;

  delete from public.customer_promo_usage u
   where (p_document_type = 'estimate' and u.estimate_id = p_document_id and u.so_id is null)
      or (p_document_type = 'sales_order' and u.so_id = p_document_id)
      or (p_source_estimate_id is not null and u.estimate_id = p_source_estimate_id and u.so_id is null);

  if v_promo > 0 then
    v_period_start := case when extract(month from current_date) <= 6
      then extract(year from current_date)::integer || '-01-01'
      else extract(year from current_date)::integer || '-07-01' end;
    v_period_end := case when extract(month from current_date) <= 6
      then extract(year from current_date)::integer || '-06-30'
      else extract(year from current_date)::integer || '-12-31' end;

    -- Preserve the existing fixed-program behavior, but make period creation
    -- deterministic and part of this same transaction.
    if not exists (
      select 1 from public.customer_promo_periods
       where customer_id = v_promo_owner_id and period_start = v_period_start
    ) then
      select round(coalesce(sum(fixed_amount), 0)::numeric, 2) into v_available
        from public.customer_promo_programs
       where customer_id = v_promo_owner_id
         and is_active is not false
         and type = 'fixed'
         and coalesce(fixed_amount, 0) > 0;
      if v_available > 0 then
        insert into public.customer_promo_periods
          (id, customer_id, period_start, period_end, allocated, used, created_at)
        values
          ('pp_' || v_promo_owner_id || '_' || v_period_start,
           v_promo_owner_id, v_period_start, v_period_end, v_available, 0, now())
        on conflict (id) do nothing;
      end if;
    end if;

    -- Row locks make the available-balance check authoritative even when two
    -- tabs spend the same family pool concurrently.
    perform 1 from public.customer_promo_periods
     where customer_id = v_promo_owner_id
     order by period_start, id
     for update;
    select round(coalesce(sum(greatest(0, allocated - used)), 0)::numeric, 2)
      into v_available
      from public.customer_promo_periods
     where customer_id = v_promo_owner_id
       and (period_start >= v_period_start or id = any(v_old_promo_period_ids));
    if v_promo > v_available then
      raise exception 'promo funds insufficient: requested %, available %', v_promo, v_available
        using errcode = 'P0001';
    end if;

    v_remaining := v_promo;
    for v_period in
      select * from public.customer_promo_periods
       where customer_id = v_promo_owner_id
         and (period_start >= v_period_start or id = any(v_old_promo_period_ids))
       order by period_start, id
       for update
    loop
      exit when v_remaining <= 0;
      v_take := least(v_remaining, greatest(0, round((v_period.allocated - v_period.used)::numeric, 2)));
      if v_take > 0 then
        update public.customer_promo_periods set used = round((used + v_take)::numeric, 2) where id = v_period.id;
        insert into public.customer_promo_usage
          (period_id, so_id, estimate_id, amount, description, created_by, created_at)
        values
          (v_period.id,
           case when p_document_type = 'sales_order' then p_document_id else null end,
           case when p_document_type = 'estimate' then p_document_id else coalesce(p_source_estimate_id, v_document_estimate_id) end,
           v_take, coalesce(p_description, 'Funds on ' || p_document_id), v_created_by, now());
        v_remaining := round((v_remaining - v_take)::numeric, 2);
      end if;
    end loop;
    if v_remaining > 0 then
      raise exception 'promo allocation could not be completed' using errcode = 'P0001';
    end if;
  end if;

  -- Credits remain owned by the selected customer (promo alone is shared with
  -- the parent family). Restore and replace this document/source allocation.
  perform 1 from public.customer_credit_usage u
   where (p_document_type = 'estimate' and u.estimate_id = p_document_id and u.so_id is null)
      or (p_document_type = 'sales_order' and u.so_id = p_document_id)
      or (p_source_estimate_id is not null and u.estimate_id = p_source_estimate_id and u.so_id is null)
   order by u.id
   for update;
  for v_old in
    select u.credit_id, sum(u.amount)::numeric(12,2) as amount
      from public.customer_credit_usage u
     where (p_document_type = 'estimate' and u.estimate_id = p_document_id and u.so_id is null)
        or (p_document_type = 'sales_order' and u.so_id = p_document_id)
        or (p_source_estimate_id is not null and u.estimate_id = p_source_estimate_id and u.so_id is null)
     group by u.credit_id
     order by u.credit_id
  loop
    update public.customer_credits
       set used = round((coalesce(used, 0) - v_old.amount)::numeric, 2)
     where id = v_old.credit_id and customer_id = p_customer_id;
    if not found then
      raise exception 'credit usage points outside the customer account';
    end if;
  end loop;

  delete from public.customer_credit_usage u
   where (p_document_type = 'estimate' and u.estimate_id = p_document_id and u.so_id is null)
      or (p_document_type = 'sales_order' and u.so_id = p_document_id)
      or (p_source_estimate_id is not null and u.estimate_id = p_source_estimate_id and u.so_id is null);

  perform 1 from public.customer_credits
   where customer_id = p_customer_id
   order by created_at, id
   for update;
  select round(coalesce(sum(greatest(0, amount - used)), 0)::numeric, 2)
    into v_available
    from public.customer_credits
   where customer_id = p_customer_id;
  if v_credit > v_available then
    raise exception 'account credit insufficient: requested %, available %', v_credit, v_available
      using errcode = 'P0001';
  end if;

  v_remaining := v_credit;
  for v_credit_row in
    select * from public.customer_credits
     where customer_id = p_customer_id
     order by created_at, id
     for update
  loop
    exit when v_remaining <= 0;
    v_take := least(v_remaining, greatest(0, round((v_credit_row.amount - v_credit_row.used)::numeric, 2)));
    if v_take > 0 then
      update public.customer_credits set used = round((used + v_take)::numeric, 2) where id = v_credit_row.id;
      insert into public.customer_credit_usage
        (credit_id, so_id, estimate_id, amount, description, created_by, created_at)
      values
        (v_credit_row.id,
         case when p_document_type = 'sales_order' then p_document_id else null end,
         case when p_document_type = 'estimate' then p_document_id else coalesce(p_source_estimate_id, v_document_estimate_id) end,
         v_take, coalesce(p_description, 'Credit on ' || p_document_id), v_created_by, now());
      v_remaining := round((v_remaining - v_take)::numeric, 2);
    end if;
  end loop;
  if v_remaining > 0 then
    raise exception 'credit allocation could not be completed' using errcode = 'P0001';
  end if;

  if p_document_type = 'estimate' then
    update public.estimates
       set promo_applied = (v_promo > 0), promo_amount = v_promo,
           credit_applied = (v_credit > 0), credit_amount = v_credit,
           fund_allocation_status = 'posted', fund_allocation_error = null,
           fund_allocation_updated_at = now(),
           updated_at = now()
     where id = p_document_id;
  else
    update public.sales_orders
       set promo_applied = (v_promo > 0), promo_amount = v_promo,
           credit_applied = (v_credit > 0), credit_amount = v_credit,
           fund_allocation_status = 'posted', fund_allocation_error = null,
           fund_allocation_updated_at = now()
     where id = p_document_id;
    if p_source_estimate_id is not null then
      update public.estimates
         set status = 'converted', fund_allocation_status = 'posted',
             fund_allocation_error = null, fund_allocation_updated_at = now(),
             updated_at = now()
       where id = p_source_estimate_id;
    end if;
  end if;

  return jsonb_build_object(
    'document', case when p_document_type = 'estimate'
      then (select to_jsonb(e) from public.estimates e where e.id = p_document_id)
      else (select to_jsonb(s) from public.sales_orders s where s.id = p_document_id) end,
    'promo_owner_id', v_promo_owner_id,
    'promo_periods', (select coalesce(jsonb_agg(to_jsonb(p) order by p.period_start, p.id), '[]'::jsonb)
      from public.customer_promo_periods p where p.customer_id = v_promo_owner_id),
    'promo_usage', (select coalesce(jsonb_agg(to_jsonb(u) order by u.created_at, u.id), '[]'::jsonb)
      from public.customer_promo_usage u join public.customer_promo_periods p on p.id = u.period_id
     where p.customer_id = v_promo_owner_id),
    'credits', (select coalesce(jsonb_agg(to_jsonb(c) order by c.created_at, c.id), '[]'::jsonb)
      from public.customer_credits c where c.customer_id = p_customer_id),
    'credit_usage', (select coalesce(jsonb_agg(to_jsonb(u) order by u.created_at, u.id), '[]'::jsonb)
      from public.customer_credit_usage u join public.customer_credits c on c.id = u.credit_id
     where c.customer_id = p_customer_id)
  );
end;
$$;

revoke all on function public.set_document_fund_allocation(text, text, text, numeric, numeric, text, text, text)
  from public, anon, authenticated;
grant execute on function public.set_document_fund_allocation(text, text, text, numeric, numeric, text, text, text)
  to authenticated, service_role;

commit;
