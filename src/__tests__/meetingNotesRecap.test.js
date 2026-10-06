/**
 * AI Notes end-of-day recap email: who gets one, what it shows, and that each
 * rep gets at most one per Pacific day even if the schedule overlaps.
 */
const { buildRecapEmail, groupForRecap, runRecap } = require('../../netlify/functions/meeting-notes-recap');

// 2026-10-06 17:45 PDT
const NOW = new Date('2026-10-07T00:45:00Z');
const TODAY = '2026-10-06';

const note = (over) => ({ id: 'm' + Math.random().toString(36).slice(2), team_member_id: 'r1', customer_id: 'c1', mode: 'dictated', status: 'approved', title: null, draft: null, final: null, created_at: '2026-10-06T16:00:00Z', approved_at: '2026-10-06T16:05:00Z', ...over });

// Just enough of the Supabase client for runRecap.
function fakeAdmin(db) {
  const from = (table) => {
    const filters = [];
    let op = 'select';
    let payload = null;
    const run = () => {
      const rows = (db[table] || []).filter((r) => filters.every((f) => f(r)));
      if (op === 'insert') {
        const dup = table === 'meeting_recaps' && db[table].some((r) => r.team_member_id === payload.team_member_id && r.day === payload.day);
        if (dup) return { data: null, error: { code: '23505', message: 'duplicate key' } };
        db[table].push({ ...payload });
        return { data: null, error: null };
      }
      if (op === 'delete') { db[table] = db[table].filter((r) => !rows.includes(r)); return { data: null, error: null }; }
      return { data: rows, error: null };
    };
    const api = {
      select: () => api,
      insert: (p) => { op = 'insert'; payload = p; return api; },
      delete: () => { op = 'delete'; return api; },
      eq: (k, v) => { filters.push((r) => r[k] === v); return api; },
      neq: (k, v) => { filters.push((r) => r[k] !== v); return api; },
      in: (k, vs) => { filters.push((r) => vs.includes(r[k])); return api; },
      or: (expr) => {
        const parts = expr.split(',').map((p) => { const [k, , v] = p.split(/\.(gte)\./); return [k, v]; });
        filters.push((r) => parts.some(([k, v]) => r[k] && r[k] >= v));
        return api;
      },
      limit: () => api,
      then: (res, rej) => Promise.resolve(run()).then(res, rej),
    };
    return api;
  };
  return { from };
}

describe('groupForRecap', () => {
  test('saved today, every draft waiting, and today\'s unfinished or failed notes', () => {
    const notes = [
      note({ id: 'a' }),
      note({ id: 'b', approved_at: '2026-10-05T18:00:00Z', created_at: '2026-10-05T17:00:00Z' }), // saved yesterday
      note({ id: 'c', status: 'ready', created_at: '2026-10-01T16:00:00Z', approved_at: null }), // old draft, still waiting
      note({ id: 'd', status: 'recording', approved_at: null }),
      note({ id: 'e', status: 'failed', approved_at: null, created_at: '2026-10-05T16:00:00Z' }), // failed yesterday
      // 9 PM Pacific on Oct 5 is already Oct 6 in UTC; it belongs to yesterday.
      note({ id: 'f', approved_at: '2026-10-06T04:00:00Z' }),
    ];
    const g = groupForRecap(notes, TODAY);
    expect(g.saved.map((m) => m.id)).toEqual(['a']);
    expect(g.waiting.map((m) => m.id)).toEqual(['c']);
    expect(g.unfinished.map((m) => m.id)).toEqual(['d']);
    expect(g.failed).toEqual([]);
  });
});

describe('buildRecapEmail', () => {
  test('lists each saved note with to-dos, items and the follow-up email, escaping what the AI wrote', () => {
    const groups = {
      saved: [note({ final: {
        headline: 'Coach <b>wants</b> polos', summary: 'Met with Coach Lee.',
        action_items: [{ text: 'Send quote', due_date: '2026-10-09', owner: 'rep' }, { text: 'Send roster', owner: 'Coach Lee', due_date: null }],
        line_items: [{ name: 'Polo', brand: 'Nike', quantity: 30, sizes: { M: 10, L: 20 }, decoration: 'Left chest' }],
        follow_up_email: { subject: 'Polos', body: 'Hi Coach,\nQuote coming Friday.' },
      } })],
      waiting: [note({ status: 'ready', draft: { headline: 'Booster club call' } })],
      unfinished: [], failed: [],
    };
    const mail = buildRecapEmail({ repName: 'Steve Peterson', dayLabel: 'Tue, Oct 6', groups, customerName: () => 'Lincoln HS', portal: 'https://portal.example' });
    expect(mail.subject).toBe('Your AI Notes for Tue, Oct 6: 1 note saved, 2 to-dos, 1 to review');
    expect(mail.html).toContain('Coach &lt;b&gt;wants&lt;/b&gt; polos');
    expect(mail.html).not.toContain('<b>wants</b>');
    expect(mail.html).toContain('due Fri, Oct 9');
    expect(mail.html).toContain('30× Nike Polo · M 10, L 20 · Left chest');
    expect(mail.html).toContain('Hi Coach,<br>Quote coming Friday.');
    expect(mail.html).toContain('https://portal.example/?pg=meeting_notes');
    expect(mail.text).toContain('Send roster · Coach Lee');
    expect(mail.text).toContain('Booster club call (Lincoln HS)');
  });
});

describe('runRecap', () => {
  const base = () => ({
    meetings: [note({ id: 'a', final: { headline: 'Polos', summary: 's', action_items: [] } }), note({ id: 'z', team_member_id: 'r2', status: 'approved', created_at: '2026-10-04T16:00:00Z', approved_at: '2026-10-04T16:00:00Z' })],
    team_members: [{ id: 'r1', name: 'Steve', email: 'steve@example.com', is_active: true }, { id: 'r2', name: 'Pat', email: 'pat@example.com', is_active: true }],
    customers: [{ id: 'c1', name: 'Lincoln HS' }],
    meeting_recaps: [],
  });

  test('emails each rep with notes today once, from the configured sender', async () => {
    const db = base();
    const sent = [];
    const opts = { now: NOW, brevoKey: 'k', from: 'hello@nationalsportsapparel.com', portal: 'https://p', send: async (m) => { sent.push(m); } };
    const first = await runRecap(fakeAdmin(db), opts);
    expect(first).toEqual({ today: TODAY, reps: 1, sent: 1 });
    expect(sent[0]).toMatchObject({ from: 'hello@nationalsportsapparel.com', to: 'steve@example.com' });
    expect(db.meeting_recaps).toEqual([expect.objectContaining({ team_member_id: 'r1', day: TODAY, note_count: 1 })]);
    const again = await runRecap(fakeAdmin(db), opts);
    expect(again.sent).toBe(0);
    expect(sent).toHaveLength(1);
  });

  test('a failed send releases the claim so a later run can retry', async () => {
    const db = base();
    const res = await runRecap(fakeAdmin(db), { now: NOW, brevoKey: 'k', from: 'x@y.z', portal: 'https://p', send: async () => { throw new Error('brevo 500'); } });
    expect(res.sent).toBe(0);
    expect(db.meeting_recaps).toEqual([]);
  });
});
