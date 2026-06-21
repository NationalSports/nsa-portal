-- Adds assigned_todos and todo_comments to the supabase_realtime publication
-- so the client's dashboard "Assigned Tasks" subscription receives
-- INSERT/UPDATE/DELETE events instantly.
--
-- Background: src/App.js subscribes to these tables for realtime updates,
-- but they were never added to the publication. As a result, a task
-- assigned to a user on one device/session did not appear on that user's
-- already-open dashboard — assignedTodos was only ever populated on the
-- initial page load and by the user's own local mutations, never refreshed
-- from the DB. The client now also refreshes assigned_todos on its polling
-- full-sync cycle, but realtime is what makes newly-assigned tasks show up
-- immediately.
--
-- Rollback (run via SQL editor if needed):
--   ALTER PUBLICATION supabase_realtime DROP TABLE public.assigned_todos;
--   ALTER PUBLICATION supabase_realtime DROP TABLE public.todo_comments;

ALTER PUBLICATION supabase_realtime ADD TABLE public.assigned_todos;
ALTER PUBLICATION supabase_realtime ADD TABLE public.todo_comments;
