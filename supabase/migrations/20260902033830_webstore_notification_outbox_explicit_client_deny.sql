-- The outbox is service-only. An explicit always-false client policy documents
-- that intent and prevents future grants from accidentally making rows visible.
create policy webstore_notification_outbox_no_client_access
on public.webstore_notification_outbox
as restrictive
for all
to anon, authenticated
using (false)
with check (false);
