-- Keep the ordering bot's stable queue ID so existing assigned_todos rows,
-- Mac mini polling, comments, and heartbeats continue to line up. Only the
-- staff-facing team-member name changes.
UPDATE public.team_members
SET name = 'Chief of Staff (Grok Bot)',
    role = 'bot',
    is_active = true
WHERE id = 'bot-claude';
