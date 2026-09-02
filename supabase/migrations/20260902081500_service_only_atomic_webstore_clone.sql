-- The clone RPC is called only by the staff-authenticated Netlify endpoint.
-- Keep the SECURITY DEFINER function out of the signed-in PostgREST surface.

revoke all on function public.clone_webstore_atomic(uuid, text, text, boolean, boolean, boolean, uuid[])
  from public, anon, authenticated;
grant execute on function public.clone_webstore_atomic(uuid, text, text, boolean, boolean, boolean, uuid[])
  to service_role;
