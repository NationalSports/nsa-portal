-- Trigger invocation does not require client EXECUTE privileges. Keep this
-- SECURITY DEFINER queue guard out of the public RPC surface.
revoke all on function public.merge_all_school_batch_queue() from public,anon,authenticated;

-- Supabase's default privileges can grant client writes at table creation.
-- Reads stay staff-authorized by RLS; writes are performed by backend RPCs.
revoke insert,update,delete,truncate,references,trigger
  on public.all_school_house_reservations,public.all_school_batch_allocations
  from public,anon,authenticated;
