-- Sheets — a lightweight, Smartsheet-style grid tool built into the portal.
--
-- Each row of this table is ONE sheet (a document): its column definitions and row
-- data live together in the `data` jsonb blob so the whole grid loads/saves in a single
-- round-trip. The app keeps a localStorage mirror and works fully offline, syncing to
-- this table when it's present — so the feature degrades gracefully if the migration
-- hasn't been applied yet.
--
-- data shape:
--   {
--     "columns": [ { "id": "...", "name": "Task", "type": "text", "width": 200,
--                    "options": [ { "id":"...", "label":"Done", "color":"#16a34a" } ] } ],
--     "rows":    [ { "id": "...", "cells": { "<colId>": <value> } } ]
--   }
--
-- type ∈ text | longtext | number | currency | date | checkbox | select | person | link
--
-- Follows the repo convention: RLS on, single "Allow all" policy (access is gated at the
-- app layer by the portal's role system, all clients share the anon key).

CREATE TABLE IF NOT EXISTS sheets (
  id          text PRIMARY KEY,
  name        text NOT NULL DEFAULT 'Untitled Sheet',
  data        jsonb NOT NULL DEFAULT '{"columns":[],"rows":[]}'::jsonb,
  archived    boolean NOT NULL DEFAULT false,
  created_by  text,
  updated_by  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sheets_updated_at_idx ON sheets (updated_at DESC);

ALTER TABLE sheets ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN CREATE POLICY "Allow all" ON sheets FOR ALL USING (true) WITH CHECK (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
