-- Drag-and-drop file attachments for dashboard notes & reminders.
-- `attachments` is a JSON array of { url, name, type } objects (files are stored
-- in Cloudinary; only the metadata lives here). Defaults to an empty array so
-- existing rows and inserts that omit it stay valid.
alter table public.workspace_items
  add column if not exists attachments jsonb not null default '[]'::jsonb;
