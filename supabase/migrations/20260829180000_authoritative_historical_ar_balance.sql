-- Historical NetSuite transactions are useful sales history, but status + original
-- invoice total is not an AR subledger. Store an explicit remaining balance when an
-- accounting export provides it. Until it is supplied, the owner-directed fallback
-- is the original total for rows explicitly marked open.

begin;

alter table public.customer_invoices
  add column if not exists open_balance numeric;

alter table public.customer_invoices
  drop constraint if exists customer_invoices_open_balance_nonnegative;
alter table public.customer_invoices
  add constraint customer_invoices_open_balance_nonnegative
  check (open_balance is null or open_balance >= 0);

comment on column public.customer_invoices.open_balance is
  'Authoritative current amount remaining from NetSuite/QB. When NULL, AR temporarily falls back to original total only for rows explicitly marked open.';

create or replace function public.create_past_due_invoice_todos()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  rep_record record;
  todo_count int := 0;
  week_key text;
  src_key text;
begin
  week_key := to_char(now() at time zone 'UTC', 'IYYY-"W"IW');

  for rep_record in
    with past_due as (
      select
        i.id as inv_id,
        i.customer_id,
        coalesce(so.created_by, c.primary_rep_id) as rep_id,
        c.name as customer_name,
        (i.total - coalesce(i.paid, 0)) as balance,
        i.due_date as due_date_text
      from public.invoices i
      left join public.sales_orders so on so.id = i.so_id
      left join public.customers c on c.id = i.customer_id
      where i.due_date is not null
        and i.due_date <> ''
        and i.due_date ~ '^\d{4}-\d{2}-\d{2}'
        and i.due_date::date < (now() at time zone 'UTC')::date
        and coalesce(i.status, 'open') not in ('paid', 'void', 'cancelled')
        and coalesce(i.paid, 0) < coalesce(i.total, 0)

      union all

      select
        ci.id as inv_id,
        ci.customer_id,
        c.primary_rep_id as rep_id,
        coalesce(c.name, ci.raw_customer_name) as customer_name,
        coalesce(ci.open_balance, ci.total) as balance,
        (ci.invoice_date + (
          case coalesce(c.payment_terms, 'net30')
            when 'prepay' then 0 when 'net15' then 15
            when 'net30' then 30 when 'net60' then 60 else 30
          end
        ))::text as due_date_text
      from public.customer_invoices ci
      left join public.customers c on c.id = ci.customer_id
      where ci.invoice_date is not null
        and coalesce(ci.type, 'invoice') = 'invoice'
        and lower(coalesce(ci.status, '')) in ('open', 'partial', 'partially_paid')
        and coalesce(ci.open_balance, ci.total) > 0
        and (ci.invoice_date + (
          case coalesce(c.payment_terms, 'net30')
            when 'prepay' then 0 when 'net15' then 15
            when 'net30' then 30 when 'net60' then 60 else 30
          end
        )) < (now() at time zone 'UTC')::date
    )
    select
      rep_id,
      count(*) as inv_count,
      count(distinct customer_id) as cust_count,
      sum(balance) as total_owed,
      string_agg(
        distinct '  • ' || customer_name || ' — $' ||
          to_char(balance, 'FM999,999,999.00') ||
          ' (' || inv_id || ', due ' || due_date_text || ')',
        E'\n'
        order by '  • ' || customer_name || ' — $' ||
          to_char(balance, 'FM999,999,999.00') ||
          ' (' || inv_id || ', due ' || due_date_text || ')'
      ) as line_summary
    from past_due
    where rep_id is not null
    group by rep_id
  loop
    if not exists (select 1 from public.team_members where id = rep_record.rep_id) then
      continue;
    end if;

    src_key := 'past_due_weekly:' || rep_record.rep_id || ':' || week_key;
    if exists (select 1 from public.assigned_todos where source = src_key) then
      continue;
    end if;

    insert into public.assigned_todos
      (id, title, description, created_by, assigned_to, priority, status, source)
    values (
      gen_random_uuid()::text,
      'Past-due invoices — ' || rep_record.cust_count || ' customer' ||
        case when rep_record.cust_count <> 1 then 's' else '' end ||
        ', $' || to_char(rep_record.total_owed, 'FM999,999,999.00'),
      'Weekly past-due invoice review (' || rep_record.inv_count || ' invoice' ||
        case when rep_record.inv_count <> 1 then 's' else '' end || '):' ||
        E'\n\n' || coalesce(rep_record.line_summary, '') ||
        E'\n\nOpen the Receivables report to coordinate collection work.',
      rep_record.rep_id,
      rep_record.rep_id,
      1,
      'open',
      src_key
    );
    todo_count := todo_count + 1;
  end loop;

  return todo_count;
end;
$$;

grant execute on function public.create_past_due_invoice_todos() to authenticated, service_role;

commit;
