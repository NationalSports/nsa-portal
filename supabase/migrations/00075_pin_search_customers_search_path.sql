-- Pins search_path on public.search_customers to address the
-- function_search_path_mutable advisor warning. Function only references
-- the `customers` table (in public schema) and uses no extension
-- functions, so 'public, pg_temp' is sufficient. pg_temp is appended so
-- a malicious temp table cannot shadow public.customers.
--
-- Behavioral change: none. Function still resolves `customers` to
-- public.customers exactly as before. Only the resolution rule is now
-- explicit and immutable instead of inheriting from the caller's
-- session search_path.
--
-- Rollback (run via SQL editor if needed):
--   ALTER FUNCTION public.search_customers(text, text, boolean, integer, integer) RESET search_path;

ALTER FUNCTION public.search_customers(text, text, boolean, integer, integer)
  SET search_path = public, pg_temp;
