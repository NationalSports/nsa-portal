// BotStatus — a small live pill showing whether the Claude bot is awake and
// how much work is waiting/needs review. Self-contained: subscribes to the
// bot_heartbeats table and treats the bot as online if it checked in recently.
//
// The queue persists regardless of this (tasks wait in assigned_todos while the
// bot is down) — this is purely visibility. See migrations 00099/00100.

import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from './lib/supabase';

const BOT_ID = 'bot-claude';
// Online if we've heard from the worker within ~2.5 polls (default poll 30s).
const ONLINE_WINDOW_MS = 75000;

export default function BotStatus({ assignedTodos = [], onClick }) {
  const [hb, setHb] = useState(null);
  const [now, setNow] = useState(Date.now());

  // Initial fetch + realtime subscription to the bot's heartbeat row.
  useEffect(() => {
    if (!supabase) return;
    let active = true;
    supabase.from('bot_heartbeats').select('*').eq('bot_id', BOT_ID).maybeSingle()
      .then(({ data }) => { if (active) setHb(data || null); });
    const ch = supabase
      .channel('bot-heartbeat')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bot_heartbeats', filter: `bot_id=eq.${BOT_ID}` },
        (payload) => setHb(payload.new || null))
      .subscribe();
    return () => { active = false; supabase.removeChannel(ch); };
  }, []);

  // Tick so "online" decays to offline without a new event.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(t);
  }, []);

  const { queued, needsReview } = useMemo(() => {
    let q = 0, r = 0;
    (assignedTodos || []).forEach((t) => {
      if (t.assigned_to !== BOT_ID || t.status !== 'open') return;
      if (t.bot_status === 'needs_review') r++;
      else if (t.bot_status === 'queued' || t.bot_status === 'in_progress') q++;
    });
    return { queued: q, needsReview: r };
  }, [assignedTodos]);

  const lastSeen = hb?.last_seen ? new Date(hb.last_seen).getTime() : 0;
  const online = lastSeen > 0 && now - lastSeen < ONLINE_WINDOW_MS;
  const working = online && hb?.status === 'working';

  const dot = working ? '#f59e0b' : online ? '#16a34a' : '#94a3b8';
  const label = working ? 'Working' : online ? 'Online' : 'Offline';
  const ago = lastSeen ? _ago(now - lastSeen) : 'never';
  const title = online
    ? `Claude bot ${label.toLowerCase()}${hb?.host ? ' on ' + hb.host : ''} · last seen ${ago} ago`
    : `Claude bot offline · last seen ${ago}. Queued tasks will run when it's back online.`;

  return (
    <span onClick={onClick} title={title}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 600,
        padding: '3px 9px', borderRadius: 999, border: '1px solid #e2e8f0', background: '#f8fafc',
        color: '#475569', cursor: onClick ? 'pointer' : 'default', whiteSpace: 'nowrap' }}>
      <span style={{ width: 8, height: 8, borderRadius: 999, background: dot,
        boxShadow: working ? '0 0 0 3px rgba(245,158,11,0.2)' : 'none' }} />
      🤖 Claude · {label}
      {queued > 0 && <span style={{ background: '#eff6ff', color: '#1e40af', borderRadius: 999, padding: '0 6px' }}>{queued} queued</span>}
      {needsReview > 0 && <span style={{ background: '#fef3c7', color: '#92400e', borderRadius: 999, padding: '0 6px' }}>{needsReview} to review</span>}
    </span>
  );
}

function _ago(ms) {
  const s = Math.floor(ms / 1000);
  if (s < 60) return s + 's';
  const m = Math.floor(s / 60);
  if (m < 60) return m + 'm';
  const h = Math.floor(m / 60);
  if (h < 24) return h + 'h';
  return Math.floor(h / 24) + 'd';
}
