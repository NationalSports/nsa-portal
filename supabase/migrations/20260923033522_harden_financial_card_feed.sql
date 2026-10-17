-- Keep provider sync atomic and independent from owner edits and posting state.
alter table public.financial_card_connections add column sync_lock_id uuid, add column sync_locked_until timestamptz;
alter table public.financial_card_accounts add column qbo_realm_id text;
alter table public.financial_card_transactions add column expense_realm_id text;
alter table public.financial_expense_rules add column expense_realm_id text;

create function public.financial_apply_card_sync(p_connection_id uuid, p_lock_id uuid,
  p_accounts jsonb, p_changes jsonb, p_removed jsonb, p_cursor text)
returns void language plpgsql security invoker set search_path = '' as $$
declare
  conn public.financial_card_connections;
  account_row public.financial_card_accounts;
  rule_row public.financial_expense_rules;
  item jsonb;
begin
  select * into conn from public.financial_card_connections where id = p_connection_id for update;
  if conn.id is null or conn.status = 'disconnected' or conn.sync_lock_id is distinct from p_lock_id
    or conn.sync_locked_until < now() then raise exception 'Card sync lease expired; retry refresh.'; end if;
  update public.financial_card_accounts set is_active = false where connection_id = conn.id;
  for item in select value from jsonb_array_elements(p_accounts) loop
    insert into public.financial_card_accounts(connection_id, company_key, provider_account_id, name, official_name,
      mask, account_type, account_subtype, currency, current_balance_cents, available_balance_cents, is_active)
    values(conn.id, conn.company_key, item->>'account_id', coalesce(item->>'name','Card account'), item->>'official_name',
      item->>'mask', item->>'type', item->>'subtype', 'USD', (item->>'current_balance_cents')::bigint,
      (item->>'available_balance_cents')::bigint, true)
    on conflict(provider_account_id) do update set name = excluded.name, official_name = excluded.official_name,
      mask = excluded.mask, account_type = excluded.account_type, account_subtype = excluded.account_subtype,
      current_balance_cents = excluded.current_balance_cents, available_balance_cents = excluded.available_balance_cents,
      is_active = true, updated_at = now()
    where public.financial_card_accounts.connection_id = conn.id;
  end loop;
  for item in select value from jsonb_array_elements(p_changes) loop
    select * into account_row from public.financial_card_accounts
      where connection_id = conn.id and provider_account_id = item->>'account_id';
    if account_row.id is null then continue; end if;
    select * into rule_row from public.financial_expense_rules
      where company_key = conn.company_key and merchant_key = item->>'merchant_key';
    insert into public.financial_card_transactions(connection_id, account_id, company_key, provider_transaction_id,
      pending_transaction_id, transaction_date, authorized_date, merchant_name, description, amount_cents, currency,
      pending, category_primary, category_detailed, status, expense_account_id, expense_account_number,
      expense_account_name, purpose, expense_realm_id)
    values(conn.id, account_row.id, conn.company_key, item->>'transaction_id', item->>'pending_transaction_id',
      (item->>'date')::date, (item->>'authorized_date')::date, item->>'merchant_name', item->>'description',
      (item->>'amount_cents')::integer, item->>'currency', (item->>'pending')::boolean,
      item->>'category_primary', item->>'category_detailed', case when rule_row.expense_realm_id is null then 'new' else 'ready' end,
      rule_row.expense_account_id, rule_row.expense_account_number, rule_row.expense_account_name, rule_row.purpose, rule_row.expense_realm_id)
    -- Never copy previously read review/link fields back over concurrent owner edits.
    on conflict(provider_transaction_id) do update set
      pending_transaction_id = excluded.pending_transaction_id, transaction_date = excluded.transaction_date,
      authorized_date = excluded.authorized_date, merchant_name = excluded.merchant_name, description = excluded.description,
      amount_cents = excluded.amount_cents, currency = excluded.currency, pending = excluded.pending, provider_removed = false,
      category_primary = excluded.category_primary, category_detailed = excluded.category_detailed, updated_at = now()
    where public.financial_card_transactions.connection_id = conn.id;
  end loop;
  update public.financial_card_transactions set provider_removed = true,
    status = case when status in ('submitted','posted') then status else 'removed' end, updated_at = now()
    where connection_id = conn.id and provider_transaction_id in (select jsonb_array_elements_text(p_removed));
  update public.financial_card_connections set sync_cursor = p_cursor, status = 'active', last_error = null,
    last_synced_at = now(), updated_at = now(), sync_lock_id = null, sync_locked_until = null where id = conn.id;
end;
$$;
revoke all on function public.financial_apply_card_sync(uuid,uuid,jsonb,jsonb,jsonb,text) from public, anon, authenticated;
grant execute on function public.financial_apply_card_sync(uuid,uuid,jsonb,jsonb,jsonb,text) to service_role;

-- Insert/cancel/post and the inbox link commit together, including on retries.
create function public.financial_expense_card_guard() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare
  card public.financial_card_transactions;
  account_row public.financial_card_accounts;
begin
  if tg_op = 'UPDATE' and new.card_transaction_id is distinct from old.card_transaction_id then
    raise exception 'An expense card source cannot be changed.';
  end if;
  if new.card_transaction_id is null then return new; end if;
  if tg_op = 'INSERT' then
    select * into card from public.financial_card_transactions where id = new.card_transaction_id for update;
    select * into account_row from public.financial_card_accounts where id = card.account_id;
    if card.id is null or card.status <> 'ready' or card.pending or card.provider_removed or card.currency <> 'USD'
      or card.company_key is distinct from new.company_key or card.amount_cents is distinct from new.amount_cents
      or card.transaction_date is distinct from new.expense_date or coalesce(card.merchant_name,card.description) is distinct from new.merchant
      or card.expense_account_id is distinct from new.expense_account_id or card.purpose is distinct from new.purpose
      or card.expense_realm_id is distinct from new.realm_id or account_row.qbo_realm_id is distinct from new.realm_id
      or account_row.qbo_payment_account_id is distinct from new.payment_account_id or new.payment_kind <> 'business' then
      raise exception 'Card transaction or mapping changed. Refresh and prepare it again.';
    end if;
  end if;
  return new;
end;
$$;
create trigger financial_expense_card_guard before insert or update on public.financial_expenses
  for each row execute function public.financial_expense_card_guard();

create function public.financial_expense_card_link() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if new.card_transaction_id is null then return new; end if;
  if new.status = 'cancelled' then
    update public.financial_card_transactions set financial_expense_id = null,
      status = case when provider_removed then 'removed' else 'ready' end, updated_at = now()
      where id = new.card_transaction_id and financial_expense_id = new.id;
  else
    update public.financial_card_transactions set financial_expense_id = new.id,
      status = case when new.status = 'posted' then 'posted' else 'submitted' end,
      expense_account_number = new.expense_account_number, expense_account_name = new.expense_account_name, updated_at = now()
      where id = new.card_transaction_id;
  end if;
  return new;
end;
$$;
create trigger financial_expense_card_link after insert or update on public.financial_expenses
  for each row execute function public.financial_expense_card_link();
revoke all on function public.financial_expense_card_guard(), public.financial_expense_card_link() from public, anon, authenticated;
grant execute on function public.financial_expense_card_guard(), public.financial_expense_card_link() to service_role;
