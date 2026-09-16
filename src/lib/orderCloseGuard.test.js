import { unfinishedProdJobs, unfinishedProdSummary } from './orderCloseGuard';

const job = (over = {}) => ({ id: 'JOB-1', art_name: 'OV Hat', prod_status: 'in_process', ...over });

describe('unfinishedProdJobs', () => {
  test('an order with no jobs owes no production (fully outsourced deco)', () => {
    expect(unfinishedProdJobs({})).toEqual([]);
    expect(unfinishedProdJobs({ jobs: [] })).toEqual([]);
    expect(unfinishedProdJobs(null)).toEqual([]);
  });

  test('completed and shipped jobs are done; draft jobs are not on the board', () => {
    const ord = { jobs: [
      job({ id: 'A', prod_status: 'completed' }),
      job({ id: 'B', prod_status: 'shipped' }),
      job({ id: 'C', prod_status: 'draft' }),
    ] };
    expect(unfinishedProdJobs(ord)).toEqual([]);
  });

  test.each(['hold', 'ready', 'staging', 'in_process'])('%s counts as unfinished', (st) => {
    expect(unfinishedProdJobs({ jobs: [job({ prod_status: st })] })).toHaveLength(1);
  });

  // The reported bug: SO-1985's only job sat in_process while the SO read 'complete'.
  test('SO-1985 shape: one in_process job blocks the close', () => {
    const so1985 = { id: 'SO-1985', status: 'complete', jobs: [
      { id: 'JOB-1985-01', art_name: 'OV Hat', deco_type: 'embroidery', prod_status: 'in_process', total_units: 15 },
    ] };
    expect(unfinishedProdJobs(so1985)).toHaveLength(1);
    expect(unfinishedProdSummary(so1985)).toBe('1 job still in production:\n  • OV Hat — In Process');
  });
});

describe('unfinishedProdSummary', () => {
  test('is empty when production is done, so it doubles as the test', () => {
    expect(unfinishedProdSummary({ jobs: [job({ prod_status: 'shipped' })] })).toBe('');
    expect(unfinishedProdSummary({ jobs: [] })).toBe('');
  });

  test('pluralises and lists each open job with its board column', () => {
    const s = unfinishedProdSummary({ jobs: [
      job({ id: 'A', art_name: 'Crest', prod_status: 'in_process' }),
      job({ id: 'B', art_name: 'Crest + Flag', prod_status: 'staging' }),
    ] });
    expect(s).toBe('2 jobs still in production:\n  • Crest — In Process\n  • Crest + Flag — In Line');
  });

  test('falls back to deco type, then job id, when art has no name', () => {
    expect(unfinishedProdSummary({ jobs: [job({ art_name: '', deco_type: 'screen_print' })] }))
      .toBe('1 job still in production:\n  • screen print — In Process');
    expect(unfinishedProdSummary({ jobs: [job({ id: 'JOB-9', art_name: '', deco_type: '' })] }))
      .toBe('1 job still in production:\n  • JOB-9 — In Process');
  });

  test('caps the list at four and counts the rest', () => {
    const jobs = ['a', 'b', 'c', 'd', 'e', 'f'].map((n) => job({ id: n, art_name: n }));
    expect(unfinishedProdSummary({ jobs })).toContain('6 jobs still in production');
    expect(unfinishedProdSummary({ jobs })).toContain('…and 2 more');
  });

  test('an unknown prod_status is reported rather than swallowed', () => {
    expect(unfinishedProdSummary({ jobs: [job({ prod_status: undefined })] }))
      .toBe('1 job still in production:\n  • OV Hat — not started');
  });
});
