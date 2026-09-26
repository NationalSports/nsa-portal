/**
 * AI meeting notes: draft validation, the approve writes (idempotent to-dos,
 * contacts appended after the last position), segment grouping, the full
 * transcribe → extract pipeline against mocked AssemblyAI/Claude, and the
 * recorder's interruption handling.
 */
const { normalizeDraft } = require('../../netlify/functions/_meetingAi');
const { groupSegments, normalizeFinal, writeApproval, processMeeting } = require('../../netlify/functions/_meetingPipeline');
import { createMeetingRecorder, createChunkUploader, extForMime } from '../meetingRecorder';

// Minimal chainable Supabase stand-in over in-memory tables + storage.
function fakeAdmin(init = {}) {
  const db = { meetings: [], meeting_transcripts: [], ai_jobs: [], assigned_todos: [], customer_contacts: [], customers: [], team_members: [], ...init };
  const files = init._files || {};
  const calls = [];
  const from = (table) => {
    const q = { filters: [], op: 'select', payload: null, opts: {} };
    const rows = () => (db[table] || []).filter((r) => q.filters.every((f) => f(r)));
    const run = () => {
      calls.push({ table, op: q.op, payload: q.payload, opts: q.opts });
      if (q.op === 'insert') { const list = [].concat(q.payload); db[table].push(...list.map((r) => ({ ...r }))); return { data: list, error: null }; }
      if (q.op === 'upsert') {
        const key = q.opts.onConflict || 'id';
        [].concat(q.payload).forEach((r) => {
          const i = db[table].findIndex((x) => x[key] === r[key]);
          if (i < 0) db[table].push({ ...r }); else if (!q.opts.ignoreDuplicates) db[table][i] = { ...db[table][i], ...r };
        });
        return { data: null, error: null };
      }
      if (q.op === 'update') { const hit = rows(); hit.forEach((r) => Object.assign(r, q.payload)); return { data: hit, error: null }; }
      if (q.op === 'delete') { const hit = new Set(rows()); db[table] = db[table].filter((r) => !hit.has(r)); return { data: null, error: null }; }
      return { data: rows(), error: null };
    };
    const api = {
      select: () => api, insert: (p) => { q.op = 'insert'; q.payload = p; return api; }, upsert: (p, o) => { q.op = 'upsert'; q.payload = p; q.opts = o || {}; return api; },
      update: (p) => { q.op = 'update'; q.payload = p; return api; }, delete: () => { q.op = 'delete'; return api; },
      eq: (c, v) => { q.filters.push((r) => r[c] === v); return api; }, neq: (c, v) => { q.filters.push((r) => r[c] !== v); return api; },
      in: (c, v) => { q.filters.push((r) => v.includes(r[c])); return api; }, is: (c, v) => { q.filters.push((r) => (r[c] ?? null) === v); return api; },
      lt: (c, v) => { q.filters.push((r) => r[c] < v); return api; }, order: () => api, limit: () => api,
      maybeSingle: () => Promise.resolve({ data: run().data?.[0] || null, error: null }),
      single: () => Promise.resolve({ data: run().data?.[0] || null, error: null }),
      then: (res, rej) => Promise.resolve(run()).then(res, rej),
    };
    return api;
  };
  const storage = {
    from: () => ({
      list: async (prefix) => ({ data: Object.keys(files).filter((k) => k.startsWith(prefix + '/')).map((k) => ({ name: k.slice(prefix.length + 1) })), error: null }),
      download: async (path) => ({ data: { arrayBuffer: async () => Buffer.from(files[path]) }, error: null }),
      remove: async (paths) => { paths.forEach((p) => delete files[p]); return { error: null }; },
    }),
  };
  return { from, storage, db, files, calls };
}

describe('normalizeDraft', () => {
  test('clamps the model output and drops invalid values', () => {
    const d = normalizeDraft({
      headline: 'Coach wants 30 polos',
      summary: 'Met Coach Lee.',
      sections: { products_discussed: ['Polo', '', null], decisions: 'not a list' },
      action_items: [
        { text: 'Send quote', owner: 'rep', due_date: '2026-10-02', speaker: 'A' },
        { text: 'Bad date', due_date: '2026-02-30', speaker: 'AB' },
        { text: '' },
      ],
      people_mentioned: [{ name: 'Coach Lee', role: 'Head Coach' }, { name: 'Dana Ruiz' }, { name: 'coach lee' }],
      suggested_stage: 'hot',
      suggested_next_action_date: 'next week',
      confidence: 7,
    }, { knownNames: new Set(['coach lee']) });
    expect(d.sections.products_discussed).toEqual(['Polo']);
    expect(d.sections.decisions).toEqual([]);
    expect(d.action_items).toEqual([
      { text: 'Send quote', owner: 'rep', due_date: '2026-10-02', speaker: 'A' },
      { text: 'Bad date', owner: 'rep', due_date: null, speaker: null },
    ]);
    expect(d.people_mentioned).toEqual([
      { name: 'Coach Lee', role: 'Head Coach', is_new: false },
      { name: 'Dana Ruiz', role: null, is_new: true },
    ]);
    expect(d.suggested_stage).toBeNull();
    expect(d.suggested_next_action_date).toBeNull();
    expect(d.confidence).toBe(1);
  });

  test('a draft with neither headline nor summary is rejected', () => {
    expect(() => normalizeDraft({ action_items: [] })).toThrow();
  });
});

describe('normalizeFinal', () => {
  test('drops unchecked items/people and maps speaker-letter owners to names', () => {
    const f = normalizeFinal({
      headline: 'H', summary: 'S',
      action_items: [{ text: 'Keep', owner: 'B', include: true }, { text: 'Drop', include: false }, { text: 'Mine', owner: 'Speaker A' }],
      people_mentioned: [{ name: 'Add me', add: true }, { name: 'Skip me', add: false }],
      suggested_stage: 'quoted', accept_stage: true, next_action_date: '2026-10-09',
    }, { speakerMap: { A: 'me', B: 'Coach Lee' } });
    expect(f.action_items.map((a) => [a.text, a.owner])).toEqual([['Keep', 'Coach Lee'], ['Mine', 'rep']]);
    expect(f.people_mentioned.map((p) => p.name)).toEqual(['Add me']);
    expect(f.accepted_stage).toBe('quoted');
    expect(f.next_action_date).toBe('2026-10-09');
  });
});

describe('groupSegments', () => {
  test('orders chunks per recorder session and counts missing chunks', () => {
    const segs = groupSegments([
      { name: 's1-c0000.mp4' }, { name: 's0-c0002.webm' }, { name: 's0-c0000.webm' }, { name: 's1-c0001.mp4' },
    ]);
    expect(segs.map((s) => [s.index, s.ext, s.chunks.map((c) => c.n), s.gaps])).toEqual([
      [0, 'webm', [0, 2], 1],
      [1, 'mp4', [0, 1], 0],
    ]);
  });
});

describe('writeApproval', () => {
  const meeting = { id: '11111111-1111-4111-8111-111111111111', team_member_id: 'tm1', customer_id: 'C1' };
  const final = {
    headline: 'Polos for booster night',
    action_items: [{ text: 'Send polo quote', owner: 'rep', due_date: '2026-10-02' }, { text: 'Get roster sizes', owner: 'Coach Lee', due_date: null }],
    people_mentioned: [{ name: 'Coach Lee', role: 'Head Coach' }, { name: 'Dana Ruiz', role: 'AD' }],
    sports: ['Football'],
    next_action_date: '2026-10-09',
  };

  test('creates to-dos and appends only new contacts after the last position; re-running duplicates nothing', async () => {
    const admin = fakeAdmin({ customer_contacts: [{ customer_id: 'C1', name: 'coach lee', sort_order: 0 }, { customer_id: 'C1', name: 'Pat', sort_order: 1 }] });
    const res = await writeApproval(admin, meeting, final);
    expect(res.todo_ids).toEqual([
      `todo-meeting-${meeting.id}-0`, `todo-meeting-${meeting.id}-1`, `todo-meeting-${meeting.id}-next`,
    ]);
    const todos = admin.db.assigned_todos;
    expect(todos).toHaveLength(3);
    expect(todos[0]).toMatchObject({ assigned_to: 'tm1', created_by: 'tm1', customer_id: 'C1', status: 'open', due_date: '2026-10-02', source: `meeting:${meeting.id}:0` });
    expect(todos[1].description).toMatch(/Owner: Coach Lee/);
    expect(res.contacts_added).toEqual([{ name: 'Dana Ruiz', role: 'AD', email: null, phone: null }]);
    expect(admin.db.customer_contacts.find((c) => c.name === 'Dana Ruiz')).toMatchObject({ sort_order: 2, source: 'ai_note', sport: 'Football' });

    const again = await writeApproval(admin, meeting, final);
    expect(again.contacts_added).toEqual([]);
    expect(admin.db.assigned_todos).toHaveLength(3);
    expect(admin.db.customer_contacts).toHaveLength(3);
    expect(admin.calls.filter((c) => c.table === 'assigned_todos').every((c) => c.opts.ignoreDuplicates)).toBe(true);
  });
});

describe('processMeeting', () => {
  const realFetch = global.fetch;
  afterEach(() => { global.fetch = realFetch; delete process.env.ASSEMBLYAI_API_KEY; });

  test('transcribes every segment, deletes the audio (ours and AssemblyAI\'s), and saves a ready draft', async () => {
    process.env.ASSEMBLYAI_API_KEY = 'aai';
    const m = { id: '22222222-2222-4222-8222-222222222222', team_member_id: 'tm1', customer_id: 'C1', mode: 'recorded', status: 'processing', created_at: '2026-09-25T18:00:00Z' };
    const folder = `tm1/${m.id}`;
    const admin = fakeAdmin({
      meetings: [m], customers: [{ id: 'C1', name: 'Vista HS' }], team_members: [{ id: 'tm1', name: 'Steve' }],
      _files: { [`${folder}/s0-c0000.webm`]: 'aa', [`${folder}/s0-c0001.webm`]: 'bb', [`${folder}/s1-c0000.webm`]: 'cc' },
    });
    const uploads = [];
    const deleted = [];
    let transcriptN = 0;
    global.fetch = jest.fn(async (url, opts = {}) => {
      const ok = (body) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });
      if (url.endsWith('/v2/upload')) { uploads.push(opts.body.toString()); return ok({ upload_url: 'https://cdn/' + uploads.length }); }
      if (url.endsWith('/v2/transcript') && opts.method === 'POST') { transcriptN += 1; return ok({ id: 't' + transcriptN, status: 'queued' }); }
      if (/\/v2\/transcript\/t\d$/.test(url) && opts.method === 'DELETE') { deleted.push(url); return ok({}); }
      if (/\/v2\/transcript\/t1$/.test(url)) return ok({ status: 'completed', audio_duration: 60, utterances: [{ speaker: 'A', text: 'Need 30 polos by Oct 10.', start: 0, end: 4000 }] });
      if (/\/v2\/transcript\/t2$/.test(url)) return ok({ status: 'completed', audio_duration: 30, utterances: [{ speaker: 'B', text: 'I will send a quote Friday.', start: 1000, end: 3000 }] });
      if (url.includes('api.anthropic.com')) {
        const body = JSON.parse(opts.body);
        expect(body.messages[0].content).toContain('A: Need 30 polos by Oct 10.');
        expect(body.messages[0].content).toContain('Account: Vista HS');
        return ok({ usage: { input_tokens: 500, output_tokens: 200 }, content: [{ type: 'text', text: JSON.stringify({ headline: 'Vista wants 30 polos by Oct 10', summary: 'Coach needs polos.', action_items: [{ text: 'Send quote', owner: 'B', due_date: '2026-09-26' }] }) }] });
      }
      throw new Error('unexpected fetch ' + url);
    });
    const res = await processMeeting(admin, m.id, { apiKey: 'k', pollMs: 1 });

    expect(res).toEqual({ ok: true });
    expect(uploads).toEqual(['aabb', 'cc']); // chunks of a session concatenated in order
    expect(deleted).toHaveLength(2);
    expect(Object.keys(admin.files)).toEqual([]);
    const saved = admin.db.meetings[0];
    expect(saved.status).toBe('ready');
    expect(saved.draft.headline).toBe('Vista wants 30 polos by Oct 10');
    expect(saved.duration_sec).toBe(90);
    expect(saved.audio_purged_at).toBeTruthy();
    const tr = admin.db.meeting_transcripts[0];
    expect(tr.utterances.map((u) => [u.speaker, u.start])).toEqual([['A', 0], ['B', 61000]]);
    expect(admin.db.ai_jobs.map((j) => j.provider)).toEqual(['assemblyai', 'assemblyai', 'anthropic']);
  });

  test('a transcription error marks the note failed and keeps the audio for retry', async () => {
    const m = { id: '33333333-3333-4333-8333-333333333333', team_member_id: 'tm1', mode: 'dictated', status: 'processing', created_at: '2026-09-25T18:00:00Z' };
    const admin = fakeAdmin({ meetings: [m], _files: { [`tm1/${m.id}/s0-c0000.mp4`]: 'x' } });
    const res = await processMeeting(admin, m.id, { apiKey: 'k' }); // no ASSEMBLYAI_API_KEY
    expect(res.ok).toBe(false);
    expect(admin.db.meetings[0]).toMatchObject({ status: 'failed' });
    expect(admin.db.meetings[0].error).toMatch(/ASSEMBLYAI_API_KEY/);
    expect(Object.keys(admin.files)).toHaveLength(1);
  });
});

describe('meeting recorder', () => {
  let recorders;
  beforeEach(() => {
    recorders = [];
    class FakeRecorder {
      constructor(stream, opts) { this.stream = stream; this.mimeType = (opts && opts.mimeType) || 'audio/mp4'; this.state = 'inactive'; recorders.push(this); }
      static isTypeSupported(m) { return m === 'audio/mp4'; }
      start() { this.state = 'recording'; }
      pause() { this.state = 'paused'; }
      resume() { this.state = 'recording'; }
      stop() { this.state = 'inactive'; setTimeout(() => { this.ondataavailable({ data: { size: 3 } }); this.onstop(); }, 0); }
      emit() { this.ondataavailable({ data: { size: 5 } }); }
    }
    window.MediaRecorder = FakeRecorder;
    const track = () => ({ readyState: 'live', stop() { this.readyState = 'ended'; }, addEventListener() {} });
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: async () => { const t = track(); return { getTracks: () => [t], getAudioTracks: () => [t] }; } } });
  });

  test('an interruption keeps chunks, resume starts a new segment, and a late stop from the old run is ignored', async () => {
    const chunks = [];
    const states = [];
    const r = createMeetingRecorder({ onChunk: (b, meta) => chunks.push(meta), onState: (s) => states.push(s) });
    await r.start();
    recorders[0].emit();
    // The OS kills the recorder (phone locked): onstop fires without us asking.
    recorders[0].state = 'inactive';
    recorders[0].onstop();
    expect(r.state).toBe('interrupted');
    await r.resume();
    expect(r.state).toBe('recording');
    recorders[1].emit();
    recorders[0].onstop(); // late event from the dead run must not interrupt the new one
    expect(r.state).toBe('recording');
    await r.stop();
    expect(states).toEqual(['recording', 'interrupted', 'recording', 'stopped']);
    expect(chunks.map((c) => [c.segment, c.index, c.ext, c.mime])).toEqual([
      [0, 0, 'mp4', 'audio/mp4'], [1, 0, 'mp4', 'audio/mp4'], [1, 1, 'mp4', 'audio/mp4'],
    ]);
  });

  test('extForMime maps browser formats', () => {
    expect(extForMime('audio/webm;codecs=opus')).toBe('webm');
    expect(extForMime('audio/mp4')).toBe('mp4');
    expect(extForMime('audio/ogg;codecs=opus')).toBe('ogg');
  });

  test('uploader retries failures and treats "already exists" as uploaded', async () => {
    const attempts = [];
    const results = [{ error: { message: 'network' } }, { error: null }, { error: { message: 'The resource already exists' } }];
    const supabase = { storage: { from: () => ({ upload: async (path) => { attempts.push(path); return results.shift(); } }) } };
    const up = createChunkUploader({ supabase, folder: 'tm1/m1', retryBaseMs: 1 });
    up.add('blob-a', { segment: 0, index: 0, ext: 'mp4', mime: 'audio/mp4' });
    up.add('blob-b', { segment: 0, index: 1, ext: 'mp4', mime: 'audio/mp4' });
    await up.flush();
    expect(attempts).toEqual(['tm1/m1/s0-c0000.mp4', 'tm1/m1/s0-c0000.mp4', 'tm1/m1/s0-c0001.mp4']);
    expect(up.uploaded).toBe(2);
    expect(up.pending).toBe(0);
  });
});
