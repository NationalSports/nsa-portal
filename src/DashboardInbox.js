/* eslint-disable */
// New-UI home "Inbox" card: the rep's important, untriaged emails (from My
// Email / rep_email_insights) merged with unread portal messages, newest first.
// Filter chips: Needs reply (emails) · Mentions · Portal messages.
import React, { useCallback, useEffect, useState } from 'react';

const when = (v) => {
  const d = new Date(v || 0);
  if (Number.isNaN(d.getTime()) || !v) return '';
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).replace(' ', '').toLowerCase();
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return 'Yest';
  if (now - d < 6 * 864e5) return d.toLocaleDateString('en-US', { weekday: 'short' });
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

const EMAIL_ROLES = ['admin', 'super_admin', 'gm', 'rep', 'csr'];

export default function DashboardInbox({ supabase, cu, customers, messages = [], isMention, authorName, onOpenEmail, onOpenMessage, onOpenAll, onCount }) {
  const [emails, setEmails] = useState([]);
  const [filter, setFilter] = useState('all');
  const allowed = EMAIL_ROLES.includes(cu?.role);

  const load = useCallback(async () => {
    if (!supabase || !cu?.id || !allowed) return;
    const { data, error } = await supabase.from('rep_email_insights')
      .select('id,sender_name,sender_email,subject,summary,snippet,received_at,customer_id,so_id')
      .eq('team_member_id', cu.id).eq('important', true).eq('status', 'new')
      .order('received_at', { ascending: false }).limit(20);
    if (!error) setEmails(data || []);
  }, [supabase, cu?.id, allowed]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!supabase || !cu?.id || !allowed) return;
    const ch = supabase.channel('dash-inbox-' + cu.id)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rep_email_insights', filter: 'team_member_id=eq.' + cu.id }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [supabase, cu?.id, allowed, load]);

  const custName = (id) => (customers || []).find((c) => c.id === id)?.name || '';
  const rows = [
    ...emails.map((e) => ({
      key: 'e:' + e.id, kind: 'email', ts: e.received_at,
      who: [e.sender_name || e.sender_email, custName(e.customer_id)].filter(Boolean).join(' · '),
      text: e.summary || e.subject || e.snippet || '(no subject)',
      open: () => onOpenEmail?.(e),
    })),
    ...messages.map((m) => ({
      key: 'm:' + m.id, kind: isMention?.(m) ? 'mention' : 'msg', ts: m.ts || m.created_at,
      who: [authorName?.(m.author_id) || 'Team', m.so_id || m.entity_id].filter(Boolean).join(' · '),
      text: m.text || '',
      open: () => onOpenMessage?.(m),
    })),
  ].sort((a, b) => String(b.ts || '').localeCompare(String(a.ts || '')));

  // Tell the dashboard when the inbox is empty so it can reflow the top row.
  useEffect(() => { onCount?.(rows.length); }, [rows.length, onCount]);

  const counts = { email: emails.length, mention: rows.filter((r) => r.kind === 'mention').length, msg: rows.filter((r) => r.kind !== 'email').length };
  const shown = rows.filter((r) => filter === 'all' || (filter === 'email' ? r.kind === 'email' : filter === 'mention' ? r.kind === 'mention' : r.kind !== 'email')).slice(0, 7);
  const SRC = { email: 'Email', mention: '@you', msg: 'Portal' };

  return (
    <article className="dash-card" aria-labelledby="dash-inbox-title">
      <header className="dash-card__head">
        <h3 id="dash-inbox-title">Inbox</h3>
        <span className={`dash-card__badge${rows.length ? ' is-red' : ''}`}>{rows.length}</span>
        <button type="button" className="dash-card__link" onClick={onOpenAll}>{allowed ? 'My Email →' : 'Messages →'}</button>
      </header>
      {rows.length > 0 && (
        <div className="dash-card__chips" role="tablist">
          <button type="button" className={filter === 'all' ? 'is-on' : ''} onClick={() => setFilter('all')}>All</button>
          {counts.email > 0 && <button type="button" className={filter === 'email' ? 'is-on' : ''} onClick={() => setFilter('email')}>Needs reply {counts.email}</button>}
          {counts.mention > 0 && <button type="button" className={filter === 'mention' ? 'is-on' : ''} onClick={() => setFilter('mention')}>Mentions {counts.mention}</button>}
          {counts.msg > 0 && <button type="button" className={filter === 'msg' ? 'is-on' : ''} onClick={() => setFilter('msg')}>Portal msgs {counts.msg}</button>}
        </div>
      )}
      <div className="dash-card__list">
        {shown.length === 0 && <p className="dash-card__empty">Inbox zero — new important emails and portal messages land here.</p>}
        {shown.map((r) => (
          <button key={r.key} type="button" className={`dash-row is-${r.kind}`} onClick={r.open}>
            <span className="dash-row__dot" aria-hidden="true" />
            <span className="dash-row__copy">
              <b><span className={`dash-src is-${r.kind}`}>{SRC[r.kind]}</span>{r.who}</b>
              <small>{r.text}</small>
            </span>
            <span className="dash-row__when">{when(r.ts)}</span>
          </button>
        ))}
      </div>
    </article>
  );
}
