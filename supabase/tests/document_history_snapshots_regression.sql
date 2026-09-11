-- Run after 20260911042557_per_document_history_snapshots.sql against a disposable
-- local database.  Every data change rolls back; assertion failures abort first.
begin;

do $$
declare
  test_doc constant text := '__history_regression_so__';
  first_entry jsonb := jsonb_build_object(
    'ts', 'oldest', 'captured_at', '2026-01-01T00:00:00Z', 'user', 'Regression',
    'snapshot', jsonb_build_object('id', test_doc, 'items', jsonb_build_array(1, 2))
  );
  second_entry jsonb := jsonb_build_object(
    'ts', 'middle', 'captured_at', '2026-01-02T00:00:00Z', 'user', 'Regression',
    'snapshot', jsonb_build_object('id', test_doc, 'items', jsonb_build_array(1))
  );
  third_entry jsonb := jsonb_build_object(
    'ts', 'newest', 'captured_at', '2026-01-03T00:00:00Z', 'user', 'Regression',
    'snapshot', jsonb_build_object('id', test_doc, 'items', '[]'::jsonb)
  );
  non_array_items_entry jsonb := jsonb_build_object(
    'ts', 'defensive-summary', 'captured_at', '2026-01-04T00:00:00Z', 'user', 'Regression',
    'snapshot', jsonb_build_object('id', test_doc, 'items', jsonb_build_object('bad', true))
  );
  delayed_old_entry jsonb := jsonb_build_object(
    'ts', 'delayed-old', 'captured_at', '2025-12-01T00:00:00Z', 'user', 'Regression',
    'snapshot', jsonb_build_object('id', test_doc, 'items', jsonb_build_array(1, 2, 3, 4, 5))
  );
  seq_first bigint;
  seq_second bigint;
  seq_third bigint;
  row_count bigint;
  summary_count bigint;
  good_count integer;
  good_ts text;
begin
  delete from public.document_history_snapshots
   where kind = 'so_history' and document_id = test_doc;

  -- Legacy blobs are newest-first.  Initial ingest must assign increasing seq
  -- in received chronology (oldest first).
  insert into public.app_state (id, value, updated_at)
  values (
    'so_history',
    jsonb_build_object(test_doc, jsonb_build_array(second_entry, first_entry))::text,
    now()
  )
  on conflict (id) do update
    set value = excluded.value, updated_at = excluded.updated_at;

  select min(seq), max(seq), count(*)
    into seq_first, seq_second, row_count
    from public.document_history_snapshots
   where kind = 'so_history' and document_id = test_doc;
  if row_count <> 2 or seq_first >= seq_second then
    raise exception 'legacy reverse-ordinal ingest failed: count %, seqs %/%', row_count, seq_first, seq_second;
  end if;

  -- Simulate a stale old tab: it adds newest but omits middle.  Append-only
  -- storage must retain all three even though app_state loses middle.
  update public.app_state
     set value = jsonb_build_object(test_doc, jsonb_build_array(third_entry, first_entry))::text,
         updated_at = now()
   where id = 'so_history';

  select max(seq), count(*)
    into seq_third, row_count
    from public.document_history_snapshots
   where kind = 'so_history' and document_id = test_doc;
  if row_count <> 3 or seq_third <= seq_second then
    raise exception 'stale legacy overwrite lost or misordered a snapshot: count %, newest seq %', row_count, seq_third;
  end if;

  -- Repeating the same payload and calling the new RPC with the same entry are
  -- idempotent, including canonical jsonb object-key ordering.
  update public.app_state set updated_at = now() where id = 'so_history';
  perform public.append_document_history('so_history', test_doc, first_entry);
  select count(*) into row_count
    from public.document_history_snapshots
   where kind = 'so_history' and document_id = test_doc;
  if row_count <> 3 then
    raise exception 'history dedupe failed: expected 3, got %', row_count;
  end if;

  -- A legacy malformed entry and a snapshot whose id disagrees with its map
  -- key are diagnosed and skipped without breaking the old client's write.
  update public.app_state
     set value = jsonb_build_object(
       test_doc,
       jsonb_build_array(
         third_entry,
         jsonb_build_object('snapshot', jsonb_build_object('id', '__different__', 'items', '[]'::jsonb)),
         'not-an-entry',
         first_entry
       )
     )::text,
         updated_at = now()
   where id = 'so_history';
  select count(*) into row_count
    from public.document_history_snapshots
   where kind = 'so_history' and document_id = test_doc;
  if row_count <> 3 then
    raise exception 'malformed legacy entries were inserted: expected 3, got %', row_count;
  end if;

  -- The RPC permits older snapshots whose items field is not an array.  The
  -- summary must treat those as zero instead of calling jsonb_array_length on
  -- the wrong type.
  perform public.append_document_history('so_history', test_doc, non_array_items_entry);
  -- A recovered offline entry can reach the server after newer entries.  Its
  -- greater seq must not make it the latest good snapshot.
  perform public.append_document_history('so_history', test_doc, delayed_old_entry);

  select s.snapshot_count, s.last_good_count, s.last_good_ts
    into summary_count, good_count, good_ts
    from public.document_history_summary() s
   where s.kind = 'so_history' and s.document_id = test_doc;
  if summary_count <> 5 or good_count <> 1 or good_ts <> 'middle' then
    raise exception 'summary failed: count %, good count %, good ts %', summary_count, good_count, good_ts;
  end if;

  begin
    perform public.append_document_history('wrong_kind', test_doc, first_entry);
    raise exception 'invalid kind was accepted';
  exception when sqlstate '22023' then null;
  end;

  begin
    perform public.append_document_history(null, test_doc, first_entry);
    raise exception 'null kind was accepted';
  exception when sqlstate '22023' then null;
  end;

  begin
    insert into public.document_history_snapshots (kind, document_id, entry)
    values (
      'so_history', test_doc,
      jsonb_build_object('snapshot', jsonb_build_object('id', '__different__'))
    );
    raise exception 'direct insert bypassed document-id constraint';
  exception when check_violation then null;
  end;

  begin
    insert into public.document_history_snapshots (kind, document_id, entry)
    values ('so_history', test_doc, jsonb_build_object('ts', 'missing snapshot'));
    raise exception 'direct insert accepted an entry without snapshot';
  exception when check_violation then null;
  end;

  begin
    insert into public.document_history_snapshots (kind, document_id, entry)
    values ('so_history', test_doc, jsonb_build_object('snapshot', jsonb_build_object('items', '[]'::jsonb)));
    raise exception 'direct insert accepted an entry without snapshot id';
  exception when check_violation then null;
  end;

  begin
    perform public.append_document_history(
      'so_history', test_doc,
      jsonb_build_object('snapshot', jsonb_build_object('id', '__different__', 'items', '[]'::jsonb))
    );
    raise exception 'mismatched document id was accepted';
  exception when sqlstate '22023' then null;
  end;

  if exists (
    select 1 from pg_policies
     where schemaname = 'public'
       and tablename = 'document_history_snapshots'
       and cmd in ('UPDATE', 'DELETE', 'ALL')
  ) then
    raise exception 'append-only table unexpectedly has an update/delete/all RLS policy';
  end if;
  if not exists (
    select 1 from pg_trigger
     where tgrelid = 'public.app_state'::regclass
       and tgname = 'ingest_legacy_document_history'
       and not tgisinternal
  ) then
    raise exception 'legacy app_state compatibility trigger is missing';
  end if;
  if has_table_privilege('authenticated', 'public.document_history_snapshots', 'UPDATE')
     or has_table_privilege('authenticated', 'public.document_history_snapshots', 'DELETE') then
    raise exception 'authenticated unexpectedly has update/delete table privileges';
  end if;
  if has_table_privilege('anon', 'public.document_history_snapshots', 'SELECT')
     or has_table_privilege('anon', 'public.document_history_snapshots', 'INSERT') then
    raise exception 'anon unexpectedly has history table privileges';
  end if;
  if not has_table_privilege('service_role', 'public.document_history_snapshots', 'SELECT, INSERT')
     or not has_sequence_privilege('service_role', 'public.document_history_snapshots_seq_seq', 'USAGE')
     or not has_function_privilege(
       'service_role',
       'public.append_document_history(text,text,jsonb)',
       'EXECUTE'
     ) then
    raise exception 'service_role is missing explicit history privileges';
  end if;
end;
$$;

rollback;
