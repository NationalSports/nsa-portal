/* Floor scan station (Phase 4):
 *  - job-scan's new READ-ONLY event:'resolve' — returns the job + file links
 *    without ever calling advance_job_stage, through the SAME resolver/index
 *    (no resolution-logic fork), for both staff JWT and PROD_SCAN_TOKEN auth;
 *  - the existing advance path stays intact (regression: rpc still called with
 *    p_expected);
 *  - floorLogic pure helpers (station matching, per-station production files,
 *    legal next action);
 *  - FloorStation UI: wrong-station warning, advance sends expected= and
 *    surfaces NSA_STALE_STATE by re-resolving.
 * Mock style follows jobScanResolver.test.js / teamShopQueue.test.js. */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// ── netlify function: event:'resolve' ─────────────────────────────────────
jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table) => {
      const cfg = global.__fnTables || {};
      const b = {
        select: () => b,
        in: () => b,
        eq: () => b,
        maybeSingle: () => Promise.resolve(cfg[table + ':single'] || { data: null, error: null }),
        then: (res, rej) => Promise.resolve(cfg[table] || { data: [], error: null }).then(res, rej),
      };
      return b;
    },
    rpc: (...args) => global.__fnRpc(...args),
  }),
}));
jest.mock('../../netlify/functions/_shared', () => ({ verifyUser: jest.fn() }));
const { verifyUser } = require('../../netlify/functions/_shared');
const { handler } = require('../../netlify/functions/job-scan');

const JOB_ROW = {
  id: 'j1', so_id: 'SO-1', art_file_id: 'a1', _art_ids: null,
  art_name: 'Eagles DG12345', deco_type: 'embroidery', prod_status: 'staging',
};
const JOB_DETAIL_ROW = {
  ...JOB_ROW, positions: 'Left Chest', total_units: 12, digitizing_needed: false, packed_at: null,
  notes: 'Rush — heat set at 320F', dtf_prints_status: 'received',
  items: [{ item_idx: 0, sizes: { M: 5, S: 2 } }, { item_idx: 1, sizes: { M: 3, XL: 2 } }],
};
const ART_ROW = {
  so_id: 'SO-1', id: 'a1', name: 'Eagles',
  prod_files: [{ name: 'EAGLES_DG12345.dst', url: 'https://cdn/art/EAGLES_DG12345.dst' }],
  files: [{ name: 'eagles.png', url: 'https://cdn/art/eagles.png' }],
};

const fnTables = () => ({
  so_jobs: { data: [JOB_ROW], error: null },
  'so_jobs:single': { data: JOB_DETAIL_ROW, error: null },
  so_art_files: { data: [ART_ROW], error: null },
  boxes: { data: [], error: null },
  'teamshop_dtf_print_needs:single': { data: { bin: 'A-12' }, error: null },
});

const makeEvent = (body, headers = {}) => ({
  httpMethod: 'POST', headers, queryStringParameters: {}, body: JSON.stringify(body),
});

describe('job-scan event:resolve (read-only)', () => {
  const OLD = process.env;
  beforeEach(() => {
    process.env = { ...OLD, PROD_SCAN_TOKEN: 'station-secret', SUPABASE_URL: 'http://x', SUPABASE_SERVICE_ROLE_KEY: 'k' };
    global.__fnTables = fnTables();
    global.__fnRpc = jest.fn(() => Promise.resolve({ data: { ok: true }, error: null }));
    verifyUser.mockReset();
    verifyUser.mockResolvedValue({ ok: false });
  });
  afterAll(() => { process.env = OLD; });

  test('resolves a DG scan to the job + file links WITHOUT calling advance_job_stage', async () => {
    const r = await handler(makeEvent({ code: 'DG-12345', event: 'resolve' }, { 'x-machine-token': 'station-secret' }));
    expect(r.statusCode).toBe(200);
    const body = JSON.parse(r.body);
    expect(body.ok).toBe(true);
    expect(body.resolution).toMatchObject({ ok: true, kind: 'job', so_id: 'SO-1', job_id: 'j1' });
    expect(body.job).toMatchObject({
      so_id: 'SO-1', job_id: 'j1', deco_type: 'embroidery', prod_status: 'staging',
      positions: 'Left Chest', total_units: 12,
    });
    expect(body.job.files).toEqual([
      { name: 'EAGLES_DG12345.dst', url: 'https://cdn/art/EAGLES_DG12345.dst', source: 'prod' },
      { name: 'eagles.png', url: 'https://cdn/art/eagles.png', source: 'art' },
    ]);
    // The load-bearing claim: resolve leaves the stage machine untouched.
    expect(global.__fnRpc).not.toHaveBeenCalled();
  });

  test('resolve returns the per-size breakdown (summed across items) and the job note', async () => {
    const r = await handler(makeEvent({ code: 'DG-12345', event: 'resolve' }, { 'x-machine-token': 'station-secret' }));
    const body = JSON.parse(r.body);
    expect(body.job.notes).toBe('Rush — heat set at 320F');
    expect(body.job.size_breakdown).toEqual({ S: 2, M: 8, XL: 2 }); // M summed across both items
  });

  test('resolve returns dtf_prints_status + the received bin (00212)', async () => {
    const r = await handler(makeEvent({ code: 'DG-12345', event: 'resolve' }, { 'x-machine-token': 'station-secret' }));
    const body = JSON.parse(r.body);
    expect(body.job.dtf_prints_status).toBe('received');
    expect(body.job.dtf_bin).toBe('A-12'); // looked up from the DTF need row
  });

  test('resolve works with the station token (unattended read path, no staff JWT)', async () => {
    const r = await handler(makeEvent({ code: 'EAGLES_DG12345.dst', event: 'resolve' }, { 'x-machine-token': 'station-secret' }));
    expect(r.statusCode).toBe(200);
    expect(verifyUser).not.toHaveBeenCalled(); // token satisfied the gate first
    expect(global.__fnRpc).not.toHaveBeenCalled();
  });

  test('resolve is still behind the auth gate — no token, no JWT → 401', async () => {
    const r = await handler(makeEvent({ code: 'DG-12345', event: 'resolve' }));
    expect(r.statusCode).toBe(401);
  });

  test('resolve carries no money fields to the floor', async () => {
    const r = await handler(makeEvent({ code: 'DG-12345', event: 'resolve' }, { 'x-machine-token': 'station-secret' }));
    expect(JSON.parse(r.body).job).not.toHaveProperty('price');
    expect(r.body).not.toMatch(/price|cost|total(?!_units)/);
  });

  test('regression: an advance event still reaches the RPC with p_expected', async () => {
    const r = await handler(makeEvent(
      { code: 'DG-12345', event: 'start_run', expected: 'staging' },
      { 'x-machine-token': 'station-secret' }
    ));
    expect(r.statusCode).toBe(200);
    expect(global.__fnRpc).toHaveBeenCalledWith('advance_job_stage', expect.objectContaining({
      p_so_id: 'SO-1', p_job_id: 'j1', p_event: 'start_run', p_expected: 'staging',
    }));
  });

  test('unknown events are still rejected (resolve did not loosen validation)', async () => {
    const r = await handler(makeEvent({ code: 'DG-12345', event: 'teleport' }, { 'x-machine-token': 'station-secret' }));
    expect(r.statusCode).toBe(400);
  });
});

// ── floorLogic pure helpers ────────────────────────────────────────────────
const {
  stationAccepts, stationFilesFor, previewImageFor, nextActionFor, sortedSizeEntries, notReadyMessage,
} = require('../floorstation/floorLogic');

describe('floorLogic', () => {
  const FILES = [
    { name: 'EAGLES_DG12345.dst', url: 'u1', source: 'prod' },
    { name: 'eagles-print.pdf', url: 'u2', source: 'prod' },
    { name: 'eagles.png', url: 'u3', source: 'art' },
  ];

  test('stationAccepts matches deco kinds to stations (heat press takes dtf/vinyl/patch)', () => {
    expect(stationAccepts('embroidery', 'embroidery')).toBe(true);
    expect(stationAccepts('embroidery', 'dtf')).toBe(false);
    expect(stationAccepts('heat_press', 'dtf')).toBe(true);
    expect(stationAccepts('heat_press', 'silicone_patch')).toBe(true);
    expect(stationAccepts('heat_press', 'embroidery')).toBe(false);
    expect(stationAccepts('packing', 'anything')).toBe(true);
  });

  test('embroidery station gets DSTs; heat gets prod print files (never a DST)', () => {
    expect(stationFilesFor('embroidery', FILES).map((f) => f.name)).toEqual(['EAGLES_DG12345.dst']);
    expect(stationFilesFor('heat_press', FILES).map((f) => f.name)).toEqual(['eagles-print.pdf']);
    expect(stationFilesFor('packing', FILES)).toEqual([]);
  });

  test('heat falls back to art files when no prod print file exists', () => {
    const artOnly = [{ name: 'a.dst', url: 'u1', source: 'prod' }, { name: 'a.png', url: 'u2', source: 'art' }];
    expect(stationFilesFor('dtf', artOnly).map((f) => f.name)).toEqual(['a.png']);
  });

  test('previewImageFor finds the first image', () => {
    expect(previewImageFor(FILES).name).toBe('eagles.png');
    expect(previewImageFor([{ name: 'x.dst', url: 'u' }])).toBe(null);
  });

  test('sortedSizeEntries orders sizes in wear order, drops zeros, unknown sizes last', () => {
    expect(sortedSizeEntries({ M: 8, S: 2, XL: 2 })).toEqual([['S', 2], ['M', 8], ['XL', 2]]);
    expect(sortedSizeEntries({ '2XL': 1, S: 3, L: 0 })).toEqual([['S', 3], ['2XL', 1]]);
    expect(sortedSizeEntries({ CUSTOM: 4, M: 1 })).toEqual([['M', 1], ['CUSTOM', 4]]);
    expect(sortedSizeEntries({})).toEqual([]);
    expect(sortedSizeEntries(null)).toEqual([]);
  });

  test('nextActionFor mirrors the 00192 stage machine, incl. legacy ready→hold', () => {
    expect(nextActionFor({ prod_status: 'hold' })).toMatchObject({ event: 'release', expected: 'hold' });
    expect(nextActionFor({ prod_status: 'ready' })).toMatchObject({ event: 'release', expected: 'hold' });
    expect(nextActionFor({ prod_status: 'staging' })).toMatchObject({ event: 'start_run', expected: 'staging' });
    expect(nextActionFor({ prod_status: 'in_process' })).toMatchObject({ event: 'decorated', expected: 'in_process' });
    expect(nextActionFor({ prod_status: 'completed' })).toMatchObject({ event: 'packed', expected: 'completed' });
    expect(nextActionFor({ prod_status: 'completed', packed_at: '2026-07-11' })).toBe(null);
  });

  test('notReadyMessage translates the 00205 gate rejection into floor language', () => {
    // Art not done + garments still on order → both reasons.
    expect(notReadyMessage('NSA_NOT_READY:art=needs_art,item=need_to_order'))
      .toBe('Not ready to run — art not done yet and garments not in hand yet. Check with the office before running this job.');
    // Art done but garments still on order → only the goods reason.
    expect(notReadyMessage('NSA_NOT_READY:art=art_complete,item=need_to_order'))
      .toBe('Not ready to run — garments not in hand yet. Check with the office before running this job.');
    // Art awaiting sign-off → the approval-specific phrasing.
    expect(notReadyMessage('NSA_NOT_READY:art=waiting_approval,item=items_received'))
      .toBe('Not ready to run — art still waiting for approval. Check with the office before running this job.');
    // Any other error is NOT a readiness rejection → null (caller shows generic message).
    expect(notReadyMessage('NSA_STALE_STATE:completed')).toBe(null);
    expect(notReadyMessage('some network blip')).toBe(null);
    expect(notReadyMessage(null)).toBe(null);
  });
});

// ── FloorStation UI ────────────────────────────────────────────────────────
jest.mock('../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: () => Promise.resolve({ data: { session: global.__mockSession } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    },
  },
}));
const FloorStation = require('../floorstation/FloorStation').default;

const RESOLVED_DTF_JOB = {
  so_id: 'SO-9', job_id: 'j9', art_name: 'Tigers DTF', deco_type: 'dtf',
  prod_status: 'staging', positions: 'Full Front', total_units: 8,
  digitizing_needed: false, packed_at: null,
  notes: 'Left-chest print, no back', size_breakdown: { S: 2, M: 6 },
  dtf_prints_status: 'received', dtf_bin: 'A-12',
  files: [{ name: 'tigers-print.png', url: 'https://cdn/tigers-print.png', source: 'prod' }],
};

const jsonResponse = (status, body) => Promise.resolve({
  status, json: () => Promise.resolve(body),
});

const scan = (value) => {
  const input = screen.getByLabelText('scan-input');
  fireEvent.change(input, { target: { value } });
  fireEvent.submit(input.closest('form'));
};

describe('FloorStation UI', () => {
  beforeEach(() => {
    global.__mockSession = { user: { email: 'staff@nsa.test' }, access_token: 'tok' };
    localStorage.clear();
    global.fetch = jest.fn();
  });
  afterEach(() => { delete global.fetch; });

  test('scan resolves read-only and a deco/station mismatch shows the loud warning', async () => {
    global.fetch.mockImplementation(() => jsonResponse(200, { ok: true, resolution: { ok: true }, job: RESOLVED_DTF_JOB }));
    render(<FloorStation />);
    await waitFor(() => expect(screen.getByLabelText('scan-input')).toBeTruthy());
    // default station is embroidery; the job is dtf → wrong station
    scan('DG-99999');

    await waitFor(() => expect(screen.getByText('Tigers DTF')).toBeTruthy());
    const [, opts] = global.fetch.mock.calls[0];
    expect(JSON.parse(opts.body)).toMatchObject({ code: 'DG-99999', event: 'resolve' });
    expect(opts.headers.Authorization).toBe('Bearer tok'); // staff mode
    expect(screen.getByRole('alert').textContent).toMatch(/WRONG STATION/);
    // still allowed to proceed: the next-stage button is rendered
    expect(screen.getByText('Start →')).toBeTruthy();
  });

  test('matching station shows the production file and no warning', async () => {
    global.fetch.mockImplementation(() => jsonResponse(200, { ok: true, resolution: { ok: true }, job: RESOLVED_DTF_JOB }));
    render(<FloorStation />);
    await waitFor(() => expect(screen.getByLabelText('scan-input')).toBeTruthy());
    fireEvent.click(screen.getByLabelText('station-dtf'));
    scan('DG-99999');

    await waitFor(() => expect(screen.getByText('Tigers DTF')).toBeTruthy());
    expect(screen.queryByRole('alert')).toBeFalsy();
    const link = screen.getByText('tigers-print.png');
    expect(link.getAttribute('href')).toBe('https://cdn/tigers-print.png');
    expect(localStorage.getItem('nsa_floor_station')).toBe('dtf');
    // size breakdown + the job note render on the floor sheet
    expect(screen.getByText('Notes')).toBeTruthy();
    expect(screen.getByText('Left-chest print, no back')).toBeTruthy();
    expect(screen.getByText('Sizes')).toBeTruthy();
    expect(screen.getByText('S')).toBeTruthy();
    expect(screen.getByText('M')).toBeTruthy();
    // DTF prints status chip + bin
    expect(screen.getByText('DTF prints')).toBeTruthy();
    expect(screen.getByText('RECEIVED')).toBeTruthy();
    expect(screen.getByText('· BIN A-12')).toBeTruthy();
  });

  test('advance sends expected=<shown stage> and NSA_STALE_STATE re-resolves with a notice', async () => {
    let advanceBody = null;
    global.fetch.mockImplementation((_url, opts) => {
      const body = JSON.parse(opts.body);
      if (body.event === 'resolve') {
        // after the stale advance, the server says someone moved it to in_process
        const stage = advanceBody ? 'in_process' : 'staging';
        return jsonResponse(200, { ok: true, resolution: { ok: true }, job: { ...RESOLVED_DTF_JOB, prod_status: stage } });
      }
      advanceBody = body;
      return jsonResponse(409, { ok: false, error: 'NSA_STALE_STATE: expected staging, job is in_process' });
    });
    render(<FloorStation />);
    await waitFor(() => expect(screen.getByLabelText('scan-input')).toBeTruthy());
    fireEvent.click(screen.getByLabelText('station-dtf'));
    scan('DG-99999');
    await waitFor(() => expect(screen.getByText('Start →')).toBeTruthy());

    fireEvent.click(screen.getByText('Start →'));

    await waitFor(() => expect(screen.getByText(/Someone else moved this job/)).toBeTruthy());
    expect(advanceBody).toMatchObject({
      code: 'DG-99999', event: 'start_run', expected: 'staging', so_id: 'SO-9', job_id: 'j9',
    });
    // re-resolved: the shown stage is now the server's current one
    await waitFor(() => expect(screen.getByText(/Stage: in_process/i)).toBeTruthy());
  });

  test('?token= station mode skips the staff gate and sends x-machine-token, never a JWT', async () => {
    global.__mockSession = null; // nobody signed in on the shop tablet
    window.history.pushState({}, '', '/floor-station?token=station-secret');
    global.fetch.mockImplementation(() => jsonResponse(200, { ok: true, resolution: { ok: true }, job: RESOLVED_DTF_JOB }));
    try {
      render(<FloorStation />);
      // no "Sign in to Connect first" gate in station mode
      expect(screen.queryByText(/Sign in to Connect first/)).toBeFalsy();
      scan('DG-99999');
      await waitFor(() => expect(screen.getByText('Tigers DTF')).toBeTruthy());
      const [, opts] = global.fetch.mock.calls[0];
      expect(opts.headers['x-machine-token']).toBe('station-secret');
      expect(opts.headers.Authorization).toBeUndefined();
    } finally {
      window.history.pushState({}, '', '/');
    }
  });

  test('signed-out without a token sees the plain gate', async () => {
    global.__mockSession = null;
    render(<FloorStation />);
    await waitFor(() => expect(screen.getByText(/Sign in to Connect first/)).toBeTruthy());
    expect(screen.queryByLabelText('scan-input')).toBeFalsy();
  });
});
