-- ============================================================
-- NSA Portal – Message Threading & Entity-Polymorphic Messages
-- Migration: 00018_message_threading_entity
--
-- Adds:
--   entity_type ('so','estimate','job') + entity_id to replace so_id-only model
--   thread_id for flat threading (self-referencing nullable FK)
--   Backfills existing messages with entity_type='so', entity_id=so_id
-- ============================================================

-- 1. Add entity_type + entity_id columns
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS entity_type TEXT DEFAULT 'so',
  ADD COLUMN IF NOT EXISTS entity_id TEXT,
  ADD COLUMN IF NOT EXISTS thread_id TEXT REFERENCES public.messages(id) ON DELETE SET NULL;

-- 2. Backfill: copy so_id into entity_id for all existing messages
UPDATE public.messages SET entity_id = so_id WHERE entity_id IS NULL AND so_id IS NOT NULL;

-- 3. Index for fast lookups by entity
CREATE INDEX IF NOT EXISTS idx_messages_entity ON public.messages(entity_type, entity_id);

-- 4. Index for thread replies
CREATE INDEX IF NOT EXISTS idx_messages_thread ON public.messages(thread_id) WHERE thread_id IS NOT NULL;
