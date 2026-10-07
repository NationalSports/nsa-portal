import fs from 'fs';
import path from 'path';
import { mergeExternalPoItems } from '../lib/editorPoSync';

const po = (id, extra = {}) => ({ po_id: id, M: 3, received: {}, ...extra });
const item = (extra = {}) => ({ sku: 'JX4456', color: 'Navy/White', sizes: { M: 10 }, pick_lines: [], po_lines: [], ...extra });

test('adds a missing PO from an equal or shorter list while preserving local lines', () => {
  const local = [item({ po_lines: [po('LOCAL'), po('SECOND')] })];
  const merged = mergeExternalPoItems(local, [item({ po_lines: [po('SAVED')] })]);
  expect(merged[0].po_lines.map(p => p.po_id)).toEqual(['LOCAL', 'SECOND', 'SAVED']);
  expect(local[0].po_lines).toHaveLength(2);
});

test('does not duplicate a known PO when receiving or quantity metadata differs', () => {
  const local = [item({ po_lines: [po('SAVED', { M: 7, memo: 'local edit' })] })];
  expect(mergeExternalPoItems(local, [item({ po_lines: [po('SAVED', { received: { M: 3 } })] })])).toBe(local);
});

test('deduplicates incoming identities and respects deliberate PO deletion', () => {
  const merged = mergeExternalPoItems([item()], [item({ po_lines: [po('SAVED'), po('SAVED'), po('DELETED')] })], ['DELETED']);
  expect(merged[0].po_lines.map(p => p.po_id)).toEqual(['SAVED']);
});

test('does not restore a previously loaded PO that was removed from a line', () => {
  const local = [item()];
  expect(mergeExternalPoItems(local, [item({po_lines: [po('REMOVED')]})], [], ['REMOVED'])).toBe(local);
});

test('stable line IDs route POs after reordering identical garments', () => {
  const local = [item({ line_id: 'b' }), item({ line_id: 'a' })];
  const incoming = [item({ line_id: 'a', po_lines: [po('A')] }), item({ line_id: 'b', po_lines: [po('B')] })];
  expect(mergeExternalPoItems(local, incoming).map(it => it.po_lines[0].po_id)).toEqual(['B', 'A']);
});

test('legacy matching uses unique garments instead of array positions', () => {
  const local = [item({ color: 'White' }), item()];
  const incoming = [item({ po_lines: [po('NAVY')] }), item({ color: 'White', po_lines: [po('WHITE')] })];
  expect(mergeExternalPoItems(local, incoming).map(it => it.po_lines[0].po_id)).toEqual(['WHITE', 'NAVY']);
});

test('ambiguous legacy garments, mismatched stable IDs, and swapped garments do not exchange POs', () => {
  const local = [item(), item()];
  expect(mergeExternalPoItems(local, [item({ po_lines: [po('SAVED')] }), item()])).toBe(local);
  const identified = [item({ line_id: 'a' })];
  expect(mergeExternalPoItems(identified, [item({ line_id: 'b', po_lines: [po('SAVED')] })])).toBe(identified);
  expect(mergeExternalPoItems(identified, [item({ line_id: 'a', color: 'White', po_lines: [po('SAVED')] })])).toBe(identified);
});

// Execute the actual shipped effects, including the lastSyncRef cache. This
// catches a PO-identity fix that still skips equal-count updates in one second.
describe.each(['OrderEditor.js', 'OrderEditorClassic.js'])('%s PO refresh', file => {
  const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  const start = source.indexOf('React.useEffect(()=>{', source.indexOf('const lastSyncRef='));
  const end = source.indexOf('},[order.updated_at,order.items]);', start) + '},[order.updated_at,order.items]);'.length;
  const effect = Function('order', 'o', 'dirty', 'React', 'lastSyncRef', 'safeItems', 'safePicks', 'safeJobs', 'safeArt', 'setO', 'mergeArtGroupFiles', 'mergeExternalPoItems', source.slice(start, end));
  const refresh = (local, incoming, cache = { current: '' }) => {
    let state = local;
    effect(incoming, local, true, { useEffect: fn => fn() }, cache,
      o => o.items || [], it => it.pick_lines || [], o => o.jobs || [], o => o.art_files || [],
      fn => { state = fn(state); }, (a, b) => ({ ...b, ...a }), mergeExternalPoItems);
    return state;
  };
  const order = items => ({ id: 'SO-2851', updated_at: 'same-second', _version: 4, items, jobs: [], art_files: [] });

  test('merges equal-length saved POs even when updated_at did not change', () => {
    const local = order([item({ po_lines: [po('LOCAL')] })]);
    const cache = { current: '' };
    expect(refresh(local, local, cache)).toBe(local);
    const incoming = order([item({ po_lines: [po('PO 60530 CSMSW')] })]);
    const merged = refresh(local, incoming, cache);
    expect(merged.items[0].po_lines.map(p => p.po_id)).toEqual(['LOCAL', 'PO 60530 CSMSW']);
    expect(refresh(merged, incoming)).toBe(merged);
  });

  test('does not rebase an edit onto a foreign version or resurrect a deleted PO', () => {
    const local = { ...order([item()]), memo: 'unsaved memo', _deletedPoIds: ['DELETED'] };
    const incoming = { ...order([item({ po_lines: [po('DELETED'), po('SAVED')] })]), _version: 9 };
    const merged = refresh(local, incoming);
    expect(merged._version).toBe(4);
    expect(merged.memo).toBe('unsaved memo');
    expect(merged.items[0].po_lines.map(p => p.po_id)).toEqual(['SAVED']);
  });

  test('the duplicate-purchase guard sees the newly adopted saved PO', async () => {
    const initial = order([item({po_lines: [po('LOCAL', {M: 2})]})]);
    const incoming = order([item({po_lines: [po('PO 60530 CSMSW')]})]);
    const guardStart = source.indexOf('const _poFreshDupCheck=async(entries)=>');
    const guardEnd = source.indexOf('// The per-member', guardStart);
    const body = source.slice(guardStart, guardEnd).trim().replace(/^const _poFreshDupCheck=/, '').replace(/;$/, '');
    const builder = data => ({select(){return this;},eq(){return this;},in(){return this;},then(resolve,reject){return Promise.resolve({data,error:null}).then(resolve,reject);}});
    const supabase = {from: table => builder(table === 'so_items' ? [{id:'row-1',item_index:0}] : [{so_item_id:'row-1',po_id:'PO 60530 CSMSW',sizes:{M:3},cancelled:{}}])};
    const check = o => Function('supabase','o','safeItems','safeNum','poCommitted','return ('+body+')')(
      supabase,o,x=>x.items||[],x=>Number(x)||0,(lines,size)=>lines.reduce((sum,line)=>sum+Math.max(0,(line[size]||0)-(line.cancelled?.[size]||0)),0));
    expect(await check(initial)([{idx:0,sizes:{M:1}}])).toEqual([{sku:'JX4456',pos:['PO 60530 CSMSW']}]);
    expect(await check(refresh(initial,incoming))([{idx:0,sizes:{M:1}}])).toBeNull();
  });
});
