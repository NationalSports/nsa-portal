-- Placement memory for the store Art tab: the last-used logo placement per garment
-- type (tee/hoodie/polo/…), shared by all reps. Written quietly whenever a rep applies
-- a logo; seeds the next placement so "left chest on a hoodie" lands right without
-- re-dragging. Shape: { "<garment_type>": { placement, x, y, w } }.
alter table webstore_settings add column if not exists placement_memory jsonb;
