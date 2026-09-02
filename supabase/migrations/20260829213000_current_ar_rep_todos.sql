-- Keep the rep's past-due task aligned with the current receivables ledger.
-- The previous weekly task used a week-specific source key, so old open tasks
-- accumulated with contradictory balances. This replaces them with one stable
-- task per rep, refreshed daily and completed automatically when the list clears.

begin;

create or replace function public.create_past_due_invoice_todos()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  rep_record record;
  todo_count int := 0;
  src_key text;
  todo_key text;
begin
  update public.assigned_todos
  set status = 'completed',
      completed_at = coalesce(completed_at, now()),
      completion_note = coalesce(completion_note, 'Superseded by the current live Receivables summary.'),
      updated_at = now()
  where status = 'open'
    and (source like 'past_due_weekly:%' or source like 'past_due_current:%');

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

    src_key := 'past_due_current:' || rep_record.rep_id;
    todo_key := 'todo-past-due-current-' || rep_record.rep_id;
    insert into public.assigned_todos
      (id, title, description, created_by, assigned_to, priority, status, source,
       due_date, completed_at, completed_by, completion_note, created_at, updated_at)
    values (
      todo_key,
      'Past-due invoices — ' || rep_record.cust_count || ' account' ||
        case when rep_record.cust_count <> 1 then 's' else '' end ||
        ', $' || to_char(rep_record.total_owed, 'FM999,999,999.00'),
      'Current past-due invoice review (' || rep_record.inv_count || ' invoice' ||
        case when rep_record.inv_count <> 1 then 's' else '' end || '):' ||
        E'\n\n' || coalesce(rep_record.line_summary, '') ||
        E'\n\nOpen Reports → Finance → My Receivables to work the current account list.',
      rep_record.rep_id,
      rep_record.rep_id,
      1,
      'open',
      src_key,
      (now() at time zone 'UTC')::date,
      null,
      null,
      null,
      now(),
      now()
    )
    on conflict (id) do update set
      title = excluded.title,
      description = excluded.description,
      assigned_to = excluded.assigned_to,
      priority = excluded.priority,
      status = 'open',
      source = excluded.source,
      due_date = excluded.due_date,
      completed_at = null,
      completed_by = null,
      completion_note = null,
      updated_at = now();
    todo_count := todo_count + 1;
  end loop;

  return todo_count;
end;
$$;

revoke execute on function public.create_past_due_invoice_todos() from public, anon, authenticated;
grant execute on function public.create_past_due_invoice_todos() to service_role;

do $$ begin
  perform cron.unschedule('past-due-invoice-todos-weekly');
exception when others then null;
end $$;

do $$ begin
  perform cron.unschedule('past-due-invoice-todos-daily');
exception when others then null;
end $$;

select cron.schedule(
  'past-due-invoice-todos-daily',
  '0 14 * * *',
  $$select public.create_past_due_invoice_todos();$$
);

select public.create_past_due_invoice_todos();

commit;
