/* eslint-disable */
/**
 * Regression tests for artStatusForFile — the single derivation of a job's art_status
 * from one of its art files.
 *
 * Bug (F5 / SO-1023 / SO-1625 class): the OrderEditor rebuild copy of this ladder
 * (_artStForFile) omitted the 'uploaded' branch that buildJobs (businessLogic.js) has.
 * Every artist mockup upload sets the file to status:'uploaded'. So a job whose design
 * had just received an uploaded proof derived 'needs_art' on the order page — while
 * buildJobs said 'waiting_approval' — and the regressed status PERSISTED on the next
 * save. To the rep it read as: "I added a mockup and the job jumped back to Needs Art."
 *
 * Fix: both sides now share this one function (OrderEditor via import; businessLogic
 * keeps a comment-locked mirror because it is import-free CommonJS). 'uploaded' and
 * 'needs_approval' share the waiting-approval track, guarded by hasMockupContent so a
 * genuinely mockless file still reads needs_art.
 *
 * SAFE: pure function from constants.js — no Supabase, no UI, no network.
 */

const { artStatusForFile } = require('../constants');

const withMock = (extra) => ({ item_mockups: { 'A123|Black': [{ url: 'http://x/m.jpg' }] }, ...extra });

describe('artStatusForFile', () => {
  describe('uploaded proof (the F5 regression)', () => {
    test("status 'uploaded' WITH a mockup reads waiting_approval, not needs_art", () => {
      expect(artStatusForFile(withMock({ deco_type: 'screen_print', status: 'uploaded' }))).toBe('waiting_approval');
    });
    test("status 'uploaded' with a per-garment item_mockup reads waiting_approval", () => {
      const af = { deco_type: 'screen_print', status: 'uploaded', item_mockups: { 'JX4452|Black/White': [{ url: 'http://x/j.jpg' }] } };
      expect(artStatusForFile(af)).toBe('waiting_approval');
    });
    test("status 'uploaded' with a general mockup_files entry reads waiting_approval", () => {
      expect(artStatusForFile({ deco_type: 'screen_print', status: 'uploaded', mockup_files: [{ url: 'http://x/m.jpg' }] })).toBe('waiting_approval');
    });
    test("status 'uploaded' with NO mockup still reads needs_art (does not mask a missing mock)", () => {
      expect(artStatusForFile({ deco_type: 'screen_print', status: 'uploaded' })).toBe('needs_art');
    });
  });

  describe("'needs_approval' shares the same track", () => {
    test('needs_approval WITH a mockup reads waiting_approval', () => {
      expect(artStatusForFile(withMock({ deco_type: 'screen_print', status: 'needs_approval' }))).toBe('waiting_approval');
    });
    test('needs_approval with NO mockup reads needs_art', () => {
      expect(artStatusForFile({ deco_type: 'screen_print', status: 'needs_approval' })).toBe('needs_art');
    });
  });

  describe("approved art routes by production-file confirmation", () => {
    test('approved + prod_files_attached reads art_complete', () => {
      expect(artStatusForFile({ deco_type: 'screen_print', status: 'approved', prod_files_attached: true })).toBe('art_complete');
    });
    test('approved screen print WITHOUT confirmed seps waits at production_files_needed', () => {
      expect(artStatusForFile({ deco_type: 'screen_print', status: 'approved' })).toBe('production_files_needed');
    });
    test('approved DTF without transfers waits at order_dtf_transfers', () => {
      expect(artStatusForFile({ deco_type: 'dtf', status: 'approved' })).toBe('order_dtf_transfers');
    });
    test('approved embroidery without a .dst waits at upload_emb_files', () => {
      expect(artStatusForFile({ deco_type: 'embroidery', status: 'approved' })).toBe('upload_emb_files');
    });
    test('approved embroidery WITH a live .dst reads art_complete', () => {
      expect(artStatusForFile({ deco_type: 'embroidery', status: 'approved', prod_files: [{ name: 'logo.dst' }] })).toBe('art_complete');
    });
    test('deco_type falls back to the passed hint when the art file has none', () => {
      expect(artStatusForFile({ status: 'approved' }, 'embroidery')).toBe('upload_emb_files');
    });
  });

  describe("everything else is needs_art", () => {
    test.each(['waiting_for_art', 'changes_requested', undefined, null, ''])('status %p reads needs_art', (status) => {
      expect(artStatusForFile({ deco_type: 'screen_print', status })).toBe('needs_art');
    });
    test('a null/undefined art file reads needs_art', () => {
      expect(artStatusForFile(null)).toBe('needs_art');
      expect(artStatusForFile(undefined)).toBe('needs_art');
    });
  });

  describe("parity with buildJobs' inline copy", () => {
    // The exact SO-1023 JOB-1023-04 shape that was stuck at needs_art in the DB:
    // an uploaded screen-print proof carrying one per-garment mock.
    test('the stuck-in-the-DB shape now derives waiting_approval', () => {
      const af = { deco_type: 'screen_print', status: 'uploaded', prod_files_attached: false, item_mockups: { 'KV2196|Black': [{ url: 'http://x/crest.jpg' }] }, mockup_files: [{ url: 'http://x/crest2.jpg' }] };
      expect(artStatusForFile(af)).toBe('waiting_approval');
    });
  });
});
