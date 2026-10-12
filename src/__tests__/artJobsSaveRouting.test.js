import { isArtJobsOnlyChange, stableStringify } from '../lib/artJobsSaveRouting';

const prev = {
  id: 'SO-2444', _version: 132, status: 'need_order', memo: 'Gear quote 1',
  items: [{ line_id: 'f4af', sku: 'JX4476', sizes: { M: 8 }, po_lines: [], decorations: [{ art_file_id: 'af1' }] }],
  art_files: [{ id: 'af1', prod_files: [], status: 'approved' }],
  jobs: [{ id: 'JOB-2444-03', art_status: 'art_in_progress' }, { id: 'JOB-2444-04', art_status: 'waiting_approval' }],
  _shipments: [], updated_at: '10/11/2026, 8:45:59 AM',
};

describe('isArtJobsOnlyChange', () => {
  it('routes a seps upload (art files only) to the light save', () => {
    const next = { ...prev, art_files: [{ ...prev.art_files[0], prod_files: [{ name: '11in Bulldog Basketball Seps.ai' }] }] };
    expect(isArtJobsOnlyChange(prev, next)).toBe(true);
  });
  it('routes an Art Dashboard status move (art + jobs) to the light save', () => {
    const next = { ...prev, art_files: [{ ...prev.art_files[0], prod_files_attached: true }],
      jobs: prev.jobs.map(j => j.id === 'JOB-2444-03' ? { ...j, art_status: 'art_complete', _art_moved: true } : j), updated_at: 'now' };
    expect(isArtJobsOnlyChange(prev, next)).toBe(true);
  });
  it('routes a newly built job (added, none removed)', () => {
    expect(isArtJobsOnlyChange(prev, { ...prev, jobs: [...prev.jobs, { id: 'JOB-2444-05' }] })).toBe(true);
  });
  it('keeps the full save when a line item changes', () => {
    const next = { ...prev, jobs: [...prev.jobs], items: [{ ...prev.items[0], sizes: { M: 6 } }] };
    expect(isArtJobsOnlyChange(prev, next)).toBe(false);
  });
  it('keeps the full save when an order field changes', () => {
    expect(isArtJobsOnlyChange(prev, { ...prev, art_files: [], status: 'in_production' })).toBe(false);
    expect(isArtJobsOnlyChange(prev, { ...prev, art_files: [], _shipments: [{ tracking_number: '1Z' }] })).toBe(false);
  });
  it('keeps the full save when a job is removed or deletion is requested', () => {
    expect(isArtJobsOnlyChange(prev, { ...prev, jobs: [prev.jobs[0]] })).toBe(false);
    expect(isArtJobsOnlyChange(prev, { ...prev, art_files: [], _deleteJobIds: ['JOB-2444-04'] })).toBe(false);
  });
  it('keeps the full save for a never-saved order, a different order, or no change', () => {
    expect(isArtJobsOnlyChange({ ...prev, _version: undefined }, { ...prev, art_files: [] })).toBe(false);
    expect(isArtJobsOnlyChange(prev, { ...prev, id: 'SO-1', art_files: [] })).toBe(false);
    expect(isArtJobsOnlyChange(prev, { ...prev })).toBe(false);
  });
  it('ignores key order from object spreads', () => {
    const reordered = { jobs: prev.jobs, ...prev, art_files: [{ status: 'approved', prod_files: [], id: 'af1', x: 1 }] };
    expect(isArtJobsOnlyChange(prev, reordered)).toBe(true);
  });
});

describe('stableStringify', () => {
  it('is key-order independent and skips undefined', () => {
    expect(stableStringify({ b: 1, a: { d: 2, c: 3 }, z: undefined })).toBe(stableStringify({ a: { c: 3, d: 2 }, b: 1 }));
  });
});

describe('planOrderSave', () => {
  const { planOrderSave } = require('../lib/artJobsSaveRouting');
  const base = {
    id: 'SO-2444', _version: 137, status: 'waiting_receive', items: [{ line_id: 'f4af', sku: 'JX4476', sizes: { M: 6 } }],
    art_files: [{ id: 'af1', prod_files: [] }], jobs: [{ id: 'JOB-2444-04', art_status: 'art_requested', _version: 18 }],
  };
  it('seps upload → art rows only', () => {
    expect(planOrderSave(base, { ...base, art_files: [{ id: 'af1', prod_files: [{ url: 's.ai' }] }] })).toEqual({ kind: 'art' });
  });
  it('status move → art and job rows', () => {
    expect(planOrderSave(base, { ...base, jobs: [{ ...base.jobs[0], art_status: 'art_complete' }] })).toEqual({ kind: 'artJobs' });
  });
  it('any item or header change → full save', () => {
    expect(planOrderSave(base, { ...base, items: [{ ...base.items[0], sizes: { M: 8 } }] }).kind).toBe('full');
    expect(planOrderSave(base, { ...base, status: 'in_production', art_files: [] }).kind).toBe('full');
  });
  it('special options, no touch RPC, unknown base or new order → full save', () => {
    const art = { ...base, art_files: [{ id: 'af1', prod_files: [{ url: 's.ai' }] }] };
    expect(planOrderSave(base, art, { opts: { exactAttempt: true } })).toEqual({ kind: 'full', fullOpts: { exactAttempt: true } });
    expect(planOrderSave(base, art, { touchAvailable: false }).kind).toBe('full');
    expect(planOrderSave(undefined, art).kind).toBe('full');
    expect(planOrderSave({ ...base, _version: undefined }, art).kind).toBe('full');
  });
  it('`before` in opts is a routing input, never a full-save option', () => {
    const art = { ...base, art_files: [{ id: 'af1', prod_files: [{ url: 's.ai' }] }] };
    expect(planOrderSave(base, art, { opts: { before: base } })).toEqual({ kind: 'art' });
    expect(planOrderSave(base, { ...base, memo: 'x' }, { opts: { before: base } })).toEqual({ kind: 'full', fullOpts: undefined });
  });
  it('removing a job is a full save (deletion needs the full save path)', () => {
    expect(planOrderSave(base, { ...base, jobs: [] }).kind).toBe('full');
  });
});
