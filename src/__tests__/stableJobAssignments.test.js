import fs from 'fs';
import path from 'path';
import * as helpers from '../safeHelpers';
import * as business from '../businessLogic';
import * as constants from '../constants';
import * as matching from '../lib/syncJobsMatch';
import * as stable from '../lib/stableJobAssignments';
import snapshot from './fixtures/stableArtJobCase.json';

const art = (id, deco_type = 'screen_print') => ({ id, name: id, deco_type, status: 'uploaded' });
const deco = (id, extra = {}) => ({ kind: 'art', art_file_id: id, position: 'Front', ...extra });
const item = (sku, sizes, decorations) => ({ sku, name: sku, color: 'Navy', sizes, decorations, po_lines: [], pick_lines: [] });
const row = (idx, sku, units, extra = {}) => ({ item_idx: idx, sku, name: sku, color: 'Navy', deco_idx: 0, deco_idxs: [0], units, fulfilled: 0, ...extra });
const job = (id, aid, rows, extra = {}) => ({ id, key: 'released_screen_print_' + id, _auto: true,
  art_file_id: aid, _art_ids: [aid], art_name: aid, deco_type: 'screen_print', deco_types: ['screen_print'],
  prod_status: 'hold', art_status: 'art_requested', art_requests: [{ id: 'AR-' + id, status: 'requested' }],
  assigned_artist: 'artist', items: rows, total_units: rows.reduce((n, r) => n + r.units, 0), fulfilled_units: 0, ...extra });

// Execute the actual editor callback, including all preservation and rebuild passes.
const deps = { ...helpers, ...business, ...constants, ...matching, ...stable };
delete deps.default;
const syncFor = file => {
  const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  const start = source.indexOf('const syncJobs=useCallback((opts)=>{') + 'const syncJobs=useCallback((opts)=>{'.length;
  const end = source.indexOf('},[o,af])', start);
  return (o) => new Function(...Object.keys(deps), 'o', 'af', 'opts', source.slice(start, end))(...Object.values(deps), o, o.art_files, undefined);
};

describe.each(['OrderEditor.js', 'OrderEditorClassic.js'])('%s stable art jobs', file => {
  const sync = syncFor(file);
  const twice = o => { const jobs = sync(o); expect(sync({ ...o, jobs })).toEqual(jobs); return jobs; };
  test('complex order fixture converges without losing submissions', () => {
    const jobs = twice(snapshot);
    expect(jobs.find(j => j.id === 'JOB-CASE-03')).toMatchObject({ total_units: 28, art_status: 'waiting_approval' });
    expect(jobs.find(j => j.id === 'JOB-CASE-07')).toMatchObject({ total_units: 32, art_status: 'waiting_approval' });
    for (const original of snapshot.jobs.filter(j => j.art_requests.length)) {
      expect(jobs.find(j => j.id === original.id)).toMatchObject({ art_status: original.art_status, art_requests: original.art_requests });
    }
  });
  test('corrected art groups keep matching garments together and different art separate', () => {
    const orange = job('JOB-1', 'A', [row(0, 'PREGAME', 21), row(1, 'TEE', 3)], { key: 'screen_print::art_A', _merged: true });
    const other = job('JOB-2', 'B', [row(2, 'LONGSLEEVE', 15)], { key: 'screen_print::art_B', _merged: true });
    const unsubmitted = job('JOB-3', 'A', [row(3, 'TEE', 6)], { key: 'screen_print::art_A', art_status: 'needs_art', art_requests: [], assigned_artist: null });
    const o = { id: 'SO-1', items: [item('PREGAME', { L: 21 }, [deco('A')]), item('TEE', { XL: 3 }, [deco('A')]), item('LONGSLEEVE', { M: 15 }, [deco('B')]), item('TEE', { S: 3, XL: 3 }, [deco('A')])], art_files: [art('A'), art('B')], jobs: [orange, other, unsubmitted] };
    const jobs = twice(o);
    expect(jobs).toHaveLength(2);
    expect(jobs.find(j => j.id === 'JOB-1')).toMatchObject({ total_units: 30, art_status: 'art_requested', art_requests: orange.art_requests });
    expect(jobs.find(j => j.id === 'JOB-1').items.map(r => r.item_idx)).toEqual([0, 1, 3]);
    expect(jobs.find(j => j.id === 'JOB-2')).toMatchObject({ total_units: 15, art_file_id: 'B', art_status: 'art_requested' });
  });
  test.each(['_itemsHydrated', '_decosHydrated', '_jobsHydrated', '_artHydrated'])('partial %s load leaves submissions untouched', flag => {
    const jobs = [job('JOB-1', 'A', [row(0, 'TEE', 10)])];
    expect(sync({ id: 'SO-1', items: [], art_files: [], jobs, [flag]: false })).toBe(jobs);
  });
  test('new same-art garment joins submitted job and retains request and id', () => {
    const original = job('JOB-1', 'A', [row(0, 'TEE', 10)]);
    const o = { id: 'SO-1', items: [item('TEE', { M: 6 }, [deco('A')]), item('HOOD', { L: 4 }, [deco('A')])], art_files: [art('A')], jobs: [original] };
    const jobs = twice(o);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ id: 'JOB-1', art_status: 'art_requested', total_units: 10, art_requests: original.art_requests });
    expect(jobs[0].items.map(r => r.units)).toEqual([6, 4]);
  });
  test('released split follows art after reordering and updates sizes both directions', () => {
    const original = job('JOB-1', 'A', [row(0, 'TEE', 8, { sizes: { M: 8 }, _artSplit: true, split_group: 'old' })]);
    const o = { id: 'SO-1', items: [item('TEE', { M: 10 }, [deco('B', { split_group: 'new', split_sizes: { M: 6 } }), deco('A', { split_group: 'new', split_sizes: { M: 4 } })])], art_files: [art('A'), art('B')], jobs: [original] };
    const jobs = twice(o);
    expect(jobs.find(j => j.id === 'JOB-1')).toMatchObject({ art_file_id: 'A', art_status: 'art_requested', total_units: 4, items: [{ deco_idxs: [1], sizes: { M: 4 }, units: 4 }] });
    expect(jobs.find(j => j.art_file_id === 'B').total_units).toBe(6);
  });
  test('ordinary saved sizes are refreshed after growth, reduction, and size-only change', () => {
    const original = job('JOB-1', 'A', [row(0, 'TEE', 11, { sizes: { M: 11 }, fulSizes: { M: 11 } })]);
    const o = { id: 'SO-1', items: [item('TEE', { L: 20 }, [deco('A')])], art_files: [art('A')], jobs: [original] };
    const grown = twice(o);
    expect(grown[0].total_units).toBe(20);
    expect(grown[0].items[0].sizes).toBeUndefined();
    const reduced = twice({ ...o, jobs: grown, items: [item('TEE', { S: 5 }, [deco('A')])] });
    expect(reduced[0]).toMatchObject({ total_units: 5, art_status: 'art_requested' });
    expect(reduced[0].items[0].units).toBe(5);
  });
  test('manual split families keep their allocation and do not absorb new rows', () => {
    const parent = job('JOB-1', 'A', [row(0, 'TEE', 6, { sizes: { M: 6 }, fulSizes: {} })]);
    const child = job('JOB-1-S', 'A', [row(0, 'TEE', 4, { sizes: { M: 4 }, fulSizes: {} })], { split_from: 'JOB-1' });
    const o = { id: 'SO-1', items: [item('TEE', { M: 10 }, [deco('A')]), item('HOOD', { L: 3 }, [deco('A')])], art_files: [art('A')], jobs: [parent, child] };
    const jobs = twice(o);
    expect(jobs.find(j => j.id === 'JOB-1').total_units).toBe(6);
    expect(jobs.find(j => j.id === 'JOB-1-S').total_units).toBe(4);
    expect(jobs).toHaveLength(3);
  });
  test('split sizes cannot include sizes missing from the order', () => {
    const o = { id: 'SO-1', items: [item('TEE', { S: 1, L: 4 }, [deco('A', { split_group: 'sg', split_sizes: { S: 2, L: 3, '2XL': 3 } })])], art_files: [art('A')], jobs: [] };
    expect(twice(o)[0]).toMatchObject({ total_units: 4, items: [{ sizes: { S: 1, L: 3 } }] });
  });
  test('rebuilding an auto job preserves its optimistic concurrency version', () => {
    const original = job('JOB-1', 'A', [row(0, 'TEE', 11)], { key: 'screen_print::art_A', _version: 55 });
    const o = { id: 'SO-1', items: [item('TEE', { L: 20 }, [deco('A')])], art_files: [art('A')], jobs: [original] };
    expect(twice(o)[0]).toMatchObject({ _version: 55, total_units: 20, art_status: 'art_requested' });
  });
  test('a partial art replacement releases only the changed row', () => {
    const original = job('JOB-1', 'A', [row(0, 'TEE', 5), row(1, 'HOOD', 7)]);
    const o = { id: 'SO-1', items: [item('TEE', { M: 5 }, [deco('B')]), item('HOOD', { L: 7 }, [deco('A')])], art_files: [art('A'), art('B')], jobs: [original] };
    const jobs = twice(o);
    expect(jobs.find(j => j.id === 'JOB-1')).toMatchObject({ art_file_id: 'A', total_units: 7, art_status: 'art_requested', items: [{ item_idx: 1 }] });
    expect(jobs.find(j => j.art_file_id === 'B')).toMatchObject({ total_units: 5, art_status: 'needs_art' });
  });
  test('ambiguous same-art submitted jobs do not steal each others workflow', () => {
    const one = job('JOB-1', 'A', [row(0, 'TEE', 5)]);
    const two = job('JOB-2', 'A', [row(1, 'HOOD', 7)]);
    const o = { id: 'SO-1', items: [item('TEE', { M: 5 }, [deco('A')]), item('HOOD', { L: 7 }, [deco('A')]), item('NEW', { L: 2 }, [deco('A')])], art_files: [art('A')], jobs: [one, two] };
    const jobs = twice(o);
    expect(jobs).toHaveLength(3);
    expect(jobs.find(j => j.id === 'JOB-1').art_requests).toEqual(one.art_requests);
    expect(jobs.find(j => j.id === 'JOB-2').art_requests).toEqual(two.art_requests);
  });
  test('new work does not join an in-process submitted job', () => {
    const original = job('JOB-1', 'A', [row(0, 'TEE', 5)], { prod_status: 'in_process' });
    const o = { id: 'SO-1', items: [item('TEE', { M: 5 }, [deco('A')]), item('HOOD', { L: 7 }, [deco('A')])], art_files: [art('A')], jobs: [original] };
    expect(twice(o)).toHaveLength(2);
  });
  test('an auto job with no separate workflow rejoins the submitted job', () => {
    const original = job('JOB-1', 'A', [row(0, 'TEE', 5)]);
    const stale = job('JOB-2', 'A', [row(1, 'HOOD', 2)], { key: 'screen_print::art_A', art_requests: [], assigned_artist: null, art_status: 'waiting_approval' });
    const o = { id: 'SO-1', items: [item('TEE', { M: 5 }, [deco('A')]), item('HOOD', { L: 7 }, [deco('A')])], art_files: [art('A')], jobs: [original, stale] };
    expect(twice(o)).toMatchObject([{ id: 'JOB-1', total_units: 12, art_status: 'art_requested' }]);
  });
});

test('changing one item preserves remaining submitted items', () => {
  const original = job('JOB-1', 'A', [row(0, 'TEE', 5), row(1, 'HOOD', 7)]);
  expect(stable.detachChangedArtRow(original, 0)).toMatchObject({ id: 'JOB-1', total_units: 7, art_status: 'art_requested', art_requests: original.art_requests, items: [row(1, 'HOOD', 7)] });
});
