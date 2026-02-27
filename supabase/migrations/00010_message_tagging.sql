-- ============================================================
-- NSA Portal – Message Team Member Tagging
-- Migration: 00010_message_tagging
-- ============================================================

-- Add tagged_members column to messages table for @mention support
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS tagged_members JSONB DEFAULT '[]';

-- Index for efficient lookup of messages where a user is tagged
CREATE INDEX IF NOT EXISTS idx_messages_tagged ON public.messages USING gin (tagged_members);
