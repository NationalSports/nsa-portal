-- Transactional regression fixture for 20260904224513_atomic_customer_invoice_save.
-- Run only against a disposable database after the migration. It deliberately
-- ends with ROLLBACK, so it never leaves fixture rows behind.
begin;

-- Force the child INSERT to fail after its replacement DELETE. The enclosing
-- transaction rolls this temporary test trigger/function back with the fixture.
create function public._atomic_fixture_reject_contact()
returns trigger language plpgsql as $$
begin
  if new.name = 'Rejected contact' then
    raise exception 'fixture contact rejection' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger atomic_fixture_reject_contact
before insert on public.customer_contacts
for each row execute function public._atomic_fixture_reject_contact();

do $$
declare
  v_result jsonb;
  v_count integer;
  v_memo text;
  v_version integer;
begin
  perform set_config('request.jwt.claim.role', 'service_role', true);
  select public.save_customer_atomic('{"id":"C-NEW-FIXTURE","name":"Defaulted customer"}', '[]', null)
    into v_result;
  assert v_result ->> 'ok' = 'true', 'new customer must save';
  assert (select created_at is not null and is_active and _version = 1 from public.customers where id = 'C-NEW-FIXTURE'),
    'new records must retain database defaults';
  insert into public.customers (id, name) values ('C-ATOMIC-FIXTURE', 'Atomic Fixture');
  insert into public.customer_contacts (customer_id, name, sort_order)
  values ('C-ATOMIC-FIXTURE', 'Existing contact', 0);

  -- [] is explicit deletion, and the row/header update share one transaction.
  select public.save_customer_atomic(
    '{"id":"C-ATOMIC-FIXTURE","name":"Atomic Fixture Updated"}'::jsonb,
    '[]'::jsonb,
    1
  ) into v_result;
  assert v_result ->> 'ok' = 'true', 'customer replacement should succeed';
  select count(*) into v_count from public.customer_contacts where customer_id = 'C-ATOMIC-FIXTURE';
  assert v_count = 0, 'an explicit empty contact list must delete the final contact';

  -- A bad replacement must roll back its preceding delete.
  insert into public.customer_contacts (customer_id, name, sort_order)
  values ('C-ATOMIC-FIXTURE', 'Preserved contact', 0);
  begin
    perform public.save_customer_atomic(
      '{"id":"C-ATOMIC-FIXTURE","name":"Will Not Commit"}'::jsonb,
      '[{"name":"Rejected contact"}]'::jsonb,
      2
    );
    raise exception 'expected invalid contact replacement to fail';
  exception when check_violation then
    null;
  end;
  select count(*) into v_count from public.customer_contacts where customer_id = 'C-ATOMIC-FIXTURE';
  assert v_count = 1, 'failed contact replacement must restore the old contact';
  assert (select name = 'Preserved contact' from public.customer_contacts where customer_id = 'C-ATOMIC-FIXTURE'),
    'failed contact replacement must preserve the old content';
  assert (select name = 'Atomic Fixture Updated' and _version = 2 from public.customers where id = 'C-ATOMIC-FIXTURE'),
    'failed child replacement must also roll back the parent';

  select public.save_invoice_atomic(
    '{"id":"INV-ATOMIC-FIXTURE","customer_id":"C-ATOMIC-FIXTURE","memo":"initial","total":100,"paid":0,"status":"open"}'::jsonb,
    '[{"sku":"TEE","name":"Fixture tee","qty":1,"unit_price":100,"total":100}]'::jsonb,
    '[{"amount":100,"method":"check","ref":"fixture-check","date":"2026-09-04","cc_fee":0}]'::jsonb,
    null
  ) into v_result;
  assert v_result ->> 'ok' = 'true', 'invoice create should commit header and children';

  -- Simulate another tab/service write; the stale base must not overwrite it.
  update public.invoices set memo = 'newer server memo' where id = 'INV-ATOMIC-FIXTURE';
  select _version into v_version from public.invoices where id = 'INV-ATOMIC-FIXTURE';
  select public.save_invoice_atomic(
    '{"id":"INV-ATOMIC-FIXTURE","memo":"stale draft"}'::jsonb,
    null,
    null,
    v_version - 1
  ) into v_result;
  assert v_result ->> 'reason' = 'STALE', 'stale invoice write must be rejected by the database';
  select memo into v_memo from public.invoices where id = 'INV-ATOMIC-FIXTURE';
  assert v_memo = 'newer server memo', 'stale invoice write must not clobber a newer memo';

  -- A missing payment is a rejected reversal, before the header can be changed.
  select public.save_invoice_atomic(
    '{"id":"INV-ATOMIC-FIXTURE","memo":"attempted payment removal"}'::jsonb,
    null,
    '[]'::jsonb,
    v_version
  ) into v_result;
  assert v_result ->> 'reason' = 'PAYMENT_REMOVAL_REQUIRES_REVERSAL', 'payment delete must be rejected';
  select memo into v_memo from public.invoices where id = 'INV-ATOMIC-FIXTURE';
  assert v_memo = 'newer server memo', 'rejected payment deletion must not partially update the header';
  select count(*) into v_count from public.invoice_payments where invoice_id = 'INV-ATOMIC-FIXTURE';
  assert v_count = 1, 'rejected payment deletion must preserve history';

  select public.save_invoice_atomic(
    '{"id":"INV-ATOMIC-FIXTURE","memo":"attempted ledger overwrite"}', null,
    '[{"amount":999,"method":"check","ref":"fixture-check","date":"2026-09-04","cc_fee":0}]', v_version
  ) into v_result;
  assert v_result ->> 'ok' = 'false', 'full-save snapshots cannot edit posted payment amounts';
  assert (select amount = 100 from public.invoice_payments where invoice_id = 'INV-ATOMIC-FIXTURE'),
    'rejected ledger changes must preserve the posted amount';

  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('test.staff', 'false', true);
  begin
    perform public.save_customer_atomic('{"id":"C-NEW-FIXTURE","name":"Unauthorized"}', null, 1);
    raise exception 'nonstaff call should fail';
  exception when insufficient_privilege then null;
  end;
  perform set_config('request.jwt.claim.role', 'service_role', true);

  insert into public.sales_orders (id, customer_id) values ('SO-ATOMIC-FIXTURE', 'C-ATOMIC-FIXTURE');
  insert into public.so_firm_dates (so_id, item_desc, date, approved)
  values ('SO-ATOMIC-FIXTURE', 'Existing promise', '2026-09-10', true);
  begin
    perform public.replace_so_firm_dates_atomic(
      'SO-ATOMIC-FIXTURE',
      '[{"item_desc":"Broken replacement","date":"2026-09-11","approved":"not-a-boolean"}]'::jsonb
    );
    raise exception 'expected invalid firm-date replacement to fail';
  exception when invalid_text_representation then
    null;
  end;
  select count(*) into v_count from public.so_firm_dates where so_id = 'SO-ATOMIC-FIXTURE';
  assert v_count = 1, 'failed firm-date replacement must restore the old schedule';
end;
$$;

rollback;
