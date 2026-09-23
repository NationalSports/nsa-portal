/* eslint-disable */
// New-UI home calendar: one view of everything dated for the signed-in rep.
// App passes the portal items it already has in memory (reminders, to-dos,
// SO in-hands dates, estimate follow-ups) as normalized
// { id, date:'YYYY-MM-DD', kind, title, sub, onOpen }. This component adds the
// rep's email deadlines (rep_email_insights) and Google Calendar events
// (netlify/functions/rep-calendar, read-only) for the visible range.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const KINDS = {
  google: { label: 'Calendar', color: '#2563eb' },
  reminder: { label: 'Reminder', color: '#d97706' },
  todo: { label: 'To-do', color: '#b45309' },
  so: { label: 'In-hands', color: '#b94349' },
  estimate: { label: 'Follow-up', color: '#7c3aed' },
  email: { label: 'Email deadline', color: '#0f766e' },
};

const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const fromYmd = (s) => { const [y, m, d] = String(s).split('-').map(Number); return new Date(y, m - 1, d); };
const dayLabel = (s, today) => {
  const diff = Math.round((fromYmd(s) - fromYmd(today)) / 864e5);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  return fromYmd(s).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
};
const timeLabel = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
};

async function callFn(supabase, fn, body) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('Session expired');
  const r = await fetch('/.netlify/functions/' + fn, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + session.access_token },
    body: JSON.stringify(body || {}),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || 'HTTP ' + r.status);
  return d;
}

export default function DashboardCalendar({ supabase, cu, items, onOpenEmail }) {
  const today = ymd(new Date());
  const [view, setView] = useState('agenda');
  const [month, setMonth] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [picked, setPicked] = useState(null);
  const [google, setGoogle] = useState({ state: 'loading', events: [] });
  const [emailRows, setEmailRows] = useState([]);

  // Visible range: the month grid (6 weeks) or the next 14 days for the agenda.
  const range = useMemo(() => {
    if (view === 'month') {
      const start = addDays(month, -month.getDay());
      return { from: ymd(start), to: ymd(addDays(start, 41)) };
    }
    return { from: today, to: ymd(addDays(fromYmd(today), 14)) };
  }, [view, month, today]);

  const reqId = useRef(0);
  useEffect(() => {
    if (!supabase) return;
    const id = ++reqId.current;
    callFn(supabase, 'rep-calendar', range)
      .then((d) => { if (id === reqId.current) setGoogle({ state: d.connected ? (d.calendar_scope === false ? 'noscope' : 'ok') : 'off', events: d.events || [] }); })
      .catch(() => { if (id === reqId.current) setGoogle({ state: 'error', events: [] }); });
  }, [supabase, range.from, range.to]);

  const loadEmail = useCallback(async () => {
    if (!supabase || !cu?.id) return;
    const { data, error } = await supabase.from('rep_email_insights')
      .select('id,subject,sender_name,sender_email,deadlines,tasks')
      .eq('team_member_id', cu.id).eq('status', 'new').limit(300);
    if (!error) setEmailRows(data || []);
  }, [supabase, cu?.id]);
  useEffect(() => { loadEmail(); }, [loadEmail]);

  const all = useMemo(() => {
    const out = [...(items || [])];
    for (const r of emailRows) {
      const who = r.sender_name || r.sender_email || '';
      (r.deadlines || []).forEach((d, i) => out.push({ id: `em:${r.id}:d${i}`, date: d.date, kind: 'email', title: d.label, sub: who, onOpen: onOpenEmail }));
      (r.tasks || []).forEach((t, i) => { if (t.due_date) out.push({ id: `em:${r.id}:t${i}`, date: t.due_date, kind: 'email', title: t.title, sub: who, onOpen: onOpenEmail }); });
    }
    for (const e of google.events) {
      const date = e.all_day ? String(e.start).slice(0, 10) : ymd(new Date(e.start));
      out.push({ id: `g:${e.id}:${date}`, date, kind: 'google', title: e.title, time: e.all_day ? null : timeLabel(e.start), sortTime: e.all_day ? '' : e.start, sub: e.location || '', onOpen: e.url ? () => window.open(e.url, '_blank', 'noopener') : null });
    }
    return out.filter((x) => x.date && /^\d{4}-\d{2}-\d{2}$/.test(x.date));
  }, [items, emailRows, google.events, onOpenEmail]);

  const byDay = useMemo(() => {
    const m = new Map();
    for (const x of all) { if (!m.has(x.date)) m.set(x.date, []); m.get(x.date).push(x); }
    for (const list of m.values()) list.sort((a, b) => String(a.sortTime || '').localeCompare(String(b.sortTime || '')) || a.kind.localeCompare(b.kind));
    return m;
  }, [all]);

  // Overdue: past-dated portal work (Google events and email deadlines in the past just drop off).
  const overdue = useMemo(() => all.filter((x) => x.date < today && ['reminder', 'todo', 'so', 'estimate'].includes(x.kind))
    .sort((a, b) => a.date.localeCompare(b.date)), [all, today]);

  const renderRow = (x, showDate) => {
    const k = KINDS[x.kind] || KINDS.reminder;
    return (
      <button key={x.id} type="button" className="dash-cal__item" onClick={x.onOpen || undefined} disabled={!x.onOpen} style={{ '--cal-kind': k.color }}>
        <span className="dash-cal__dot" aria-hidden="true" />
        <span className="dash-cal__item-copy">
          <strong>{x.title}</strong>
          <small>{[k.label, x.time, showDate ? dayLabel(x.date, today) : null, x.sub].filter(Boolean).join(' · ')}</small>
        </span>
      </button>
    );
  };

  const agendaDays = [];
  for (let i = 0; i < 7; i++) { const d = ymd(addDays(fromYmd(today), i)); if (byDay.get(d)?.length) agendaDays.push(d); }

  const googleNote = google.state === 'off' ? 'Connect Google in My Email to see your calendar here.'
    : google.state === 'noscope' ? 'Reconnect Google in My Email to add your calendar.'
    : google.state === 'error' ? 'Google Calendar could not load right now.' : null;

  const monthStart = addDays(month, -month.getDay());
  const cells = Array.from({ length: 42 }, (_, i) => ymd(addDays(monthStart, i)));
  const monthKey = `${month.getFullYear()}-${pad(month.getMonth() + 1)}`;

  return (
    <article className="dash-overview__panel dash-cal" aria-labelledby="dash-cal-title">
      <header className="dash-overview__panel-header">
        <div>
          <span className="dash-overview__panel-kicker">Your calendar</span>
          <h3 id="dash-cal-title">{view === 'month' ? month.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) : 'Next 7 days'}</h3>
        </div>
        <div className="dash-cal__controls">
          {view === 'month' && <>
            <button type="button" onClick={() => { setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1)); setPicked(null); }} aria-label="Previous month">‹</button>
            <button type="button" onClick={() => { const d = new Date(); setMonth(new Date(d.getFullYear(), d.getMonth(), 1)); setPicked(today); }}>Today</button>
            <button type="button" onClick={() => { setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1)); setPicked(null); }} aria-label="Next month">›</button>
          </>}
          <span className="dash-cal__toggle" role="tablist">
            {['agenda', 'month'].map((v) => <button key={v} type="button" role="tab" aria-selected={view === v} className={view === v ? 'is-active' : ''} onClick={() => setView(v)}>{v === 'agenda' ? 'Agenda' : 'Month'}</button>)}
          </span>
        </div>
      </header>

      <div className="dash-cal__legend">
        {Object.entries(KINDS).map(([k, v]) => <span key={k} style={{ '--cal-kind': v.color }}><i />{v.label}</span>)}
        {googleNote && <em>{googleNote}</em>}
      </div>

      {view === 'agenda' ? (
        <div className="dash-cal__agenda">
          {overdue.length > 0 && <section className="dash-cal__group is-overdue">
            <h4>Overdue <span>{overdue.length}</span></h4>
            {overdue.slice(0, 8).map((x) => renderRow(x, true))}
            {overdue.length > 8 && <p className="dash-cal__more">+{overdue.length - 8} more overdue</p>}
          </section>}
          {agendaDays.length === 0 && overdue.length === 0 && <p className="dash-cal__empty">Nothing scheduled this week. Add a reminder or check My Email for new tasks.</p>}
          {agendaDays.map((d) => (
            <section key={d} className={`dash-cal__group${d === today ? ' is-today' : ''}`}>
              <h4>{dayLabel(d, today)} <span>{byDay.get(d).length}</span></h4>
              {byDay.get(d).map((x) => renderRow(x))}
            </section>
          ))}
        </div>
      ) : (
        <>
          <div className="dash-cal__grid" role="grid">
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((w) => <div key={w} className="dash-cal__wd">{w}</div>)}
            {cells.map((d) => {
              const list = byDay.get(d) || [];
              const cls = ['dash-cal__cell', d.slice(0, 7) !== monthKey && 'is-out', d === today && 'is-today', d === picked && 'is-picked'].filter(Boolean).join(' ');
              return (
                <button key={d} type="button" className={cls} onClick={() => setPicked(d)}>
                  <span className="dash-cal__num">{Number(d.slice(8))}</span>
                  {list.slice(0, 3).map((x) => <span key={x.id} className="dash-cal__chip" style={{ '--cal-kind': (KINDS[x.kind] || KINDS.reminder).color }}>{x.time ? x.time + ' ' : ''}{x.title}</span>)}
                  {list.length > 3 && <span className="dash-cal__chip-more">+{list.length - 3}</span>}
                </button>
              );
            })}
          </div>
          {picked && <section className="dash-cal__group dash-cal__day">
            <h4>{dayLabel(picked, today)} <span>{(byDay.get(picked) || []).length}</span></h4>
            {(byDay.get(picked) || []).length === 0 ? <p className="dash-cal__empty">Nothing on this day.</p>
              : byDay.get(picked).map((x) => renderRow(x))}
          </section>}
        </>
      )}
    </article>
  );
}
