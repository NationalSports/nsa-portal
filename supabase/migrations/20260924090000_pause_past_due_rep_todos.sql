-- Pause the per-rep "Past-due invoices" assigned TODOs.
--
-- Collections now run off the Friday rep A/R email plus ONE weekly
-- "Weekly overdue invoices" to-do on the dashboard (computed in the client,
-- see the overdue_invoices todo in App.js). The daily job below re-created a
-- "Past-due invoices — N accounts, $X" task for every rep each morning, so reps
-- saw the same debt twice. Stop the job and close the open tasks it left.
--
-- create_past_due_invoice_todos() itself is kept, so restoring this is one
-- cron.schedule call (and PAST_DUE_REP_TODOS=true in src/ARWorkspace.js).

begin;

do $$ begin
  perform cron.unschedule('past-due-invoice-todos-daily');
exception when others then null;
end $$;

do $$ begin
  perform cron.unschedule('past-due-invoice-todos-weekly');
exception when others then null;
end $$;

update public.assigned_todos
set status = 'completed',
    completed_at = coalesce(completed_at, now()),
    completion_note = coalesce(completion_note, 'Paused — past-due invoices are now worked from the weekly overdue-invoices to-do.'),
    updated_at = now()
where status = 'open'
  and (source like 'past_due_weekly:%' or source like 'past_due_current:%');

commit;
