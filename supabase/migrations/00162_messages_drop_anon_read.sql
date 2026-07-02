-- Remove anonymous read access to the messages table.
--
-- A live policy `messages_anon_read` (anon, SELECT USING(true)) plus the anon
-- SELECT grant let anyone using the shipped anon key read the ENTIRE messages
-- table: every sales-order, issue, estimate, and webstore-order thread, including
-- internal staff notes and tagged_members. This policy was applied out-of-band and
-- never captured in a migration.
--
-- Nothing needs anon read here: the public storefront's order thread is loaded
-- server-side by netlify/functions/webstore-checkout.js (service role, loadThread);
-- every other messages query runs on an authenticated staff screen. Staff access
-- via the existing "Allow all" authenticated policy is unaffected.

DROP POLICY IF EXISTS messages_anon_read ON public.messages;
REVOKE SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.messages FROM anon;
