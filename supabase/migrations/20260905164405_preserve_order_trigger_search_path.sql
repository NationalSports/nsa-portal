-- Existing order triggers resolve legacy table references (e.g. estimates)
-- through the caller's search_path. The typed writer must preserve that context.
-- Public is not CREATE-writable by authenticated/anon; pg_temp is explicitly last.
-- This remains SECURITY INVOKER and all dynamic target tables stay schema-qualified.
alter function public._so_save_row(text,jsonb,boolean) set search_path = public, pg_temp;
