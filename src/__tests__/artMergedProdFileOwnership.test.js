/* eslint-disable */
/**
 * Regression tests for a merged job disappearing from the Art Dashboard.
 *
 * Bug (SO-2145 / JOB-2145-02): the order's front print is screen print and its
 * sleeve print is DTF. A merge put BOTH designs on one job row, which kept the
 * DTF design as the job's primary art_file_id and its deco_types as ['dtf'].
 *
 * rArtist's _repOwnsProdStep exists so an APPROVED embroidery/DTF job leaves the
 * artist board — ordering transfers and uploading a .dst are the rep/CSR's step.
 * It read only the job's PRIMARY art file, so the merged job looked purely DTF and
 * was dropped from `artistJobs`. It was not art_complete either, so it fell out of
 * In Production and Hidden as well: the job was gathered and then rendered in NO
 * column at all, while its screen-print SEPARATIONS were still outstanding.
 *
 * Fix: judge the step by EVERY design still awaiting production files. Screen print
 * is artist work, so one pending screen print keeps the whole job on the board.
 *
 * SAFE: pure functions from constants.js — no Supabase, no UI, no network.
 */

const fs = require('fs');
const path = require('path');
const { REP_PROD_FILE_DECOS, artistOwesProdFiles, PROD_FILES_STATUSES } = require('../constants');

describe('artistOwesProdFiles — who owns the production-files step', () => {
  test('screen print is artist work (separations), so the artist still owes files', () => {
    expect(artistOwesProdFiles(['screen_print'])).toBe(true);
  });

  test('DTF, heat press and embroidery are all rep-owned steps', () => {
    expect(artistOwesProdFiles(['dtf'])).toBe(false);
    expect(artistOwesProdFiles(['heat_press'])).toBe(false);
    expect(artistOwesProdFiles(['embroidery'])).toBe(false);
    expect(artistOwesProdFiles(['dtf', 'embroidery', 'heat_press'])).toBe(false);
  });

  test('THE REPORTED SHAPE: a merged DTF + screen-print job still owes artist files', () => {
    // JOB-2145-02 carries both designs; the DTF one is primary.
    expect(artistOwesProdFiles(['dtf', 'screen_print'])).toBe(true);
    // Order must not matter — the merge can keep either design as primary.
    expect(artistOwesProdFiles(['screen_print', 'dtf'])).toBe(true);
  });

  test('a design with no recorded deco type is not assumed rep-owned', () => {
    expect(artistOwesProdFiles([''])).toBe(true);
    expect(artistOwesProdFiles([null])).toBe(true);
    expect(artistOwesProdFiles([undefined])).toBe(true);
  });

  test('nothing pending means nothing is owed — the caller falls back to the primary design', () => {
    expect(artistOwesProdFiles([])).toBe(false);
    expect(artistOwesProdFiles(null)).toBe(false);
    expect(artistOwesProdFiles(undefined)).toBe(false);
  });

  test('screen print is deliberately absent from the rep-owned list', () => {
    expect(REP_PROD_FILE_DECOS).toEqual(['embroidery', 'dtf', 'heat_press']);
    expect(REP_PROD_FILE_DECOS).not.toContain('screen_print');
  });
});

describe('Art Dashboard wiring — _repOwnsProdStep consults every pending design', () => {
  const app = fs.readFileSync(path.join(__dirname, '../App.js'), 'utf8');
  const fn = app.slice(app.indexOf('const _repOwnsProdStep='), app.indexOf('const _ART_COL_RANK='));

  test('the predicate asks artistOwesProdFiles before dropping a job off the board', () => {
    expect(fn).toContain('artistOwesProdFiles(pendingDecos)');
    // It must gather the job's LIVE art (all designs), not just j.artFile.
    expect(fn).toContain('jobLiveArtIds(j,j.so)');
    expect(fn).toContain('artProdFilesConfirmed(a)');
  });

  test('the bail-out runs before the primary-design check, so one pending screen print wins', () => {
    expect(fn.indexOf('artistOwesProdFiles(pendingDecos)')).toBeLessThan(fn.indexOf("j.art_status==='order_dtf_transfers'"));
  });

  test('the deco list is no longer inlined at the call site', () => {
    expect(fn).not.toMatch(/\['embroidery','dtf','heat_press'\]/);
    expect(fn).toContain('REP_PROD_FILE_DECOS');
  });

  test('only production-file stages are ever considered rep-owned', () => {
    expect(fn).toContain('PROD_FILES_STATUSES.includes(j.art_status)');
    expect(PROD_FILES_STATUSES).toEqual(['production_files_needed', 'order_dtf_transfers', 'upload_emb_files']);
  });

  test('the artist board still filters on the predicate', () => {
    expect(app).toContain('!_repOwnsProdStep(j)');
  });
});
