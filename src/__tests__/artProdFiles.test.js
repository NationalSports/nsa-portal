/* eslint-disable */
/**
 * Regression tests for the production-files (separations) stage gate.
 *
 * Bug: a PDF that merely landed in an art file's prod_files (e.g. an order sheet
 * attached before approval) made artProdFilesReady() true, so rep approval jumped
 * the job straight past 'production_files_needed' ("needs separation") to
 * art_complete — even though the per-design "Production Files by Design" checkbox
 * (prod_files_attached) was never clicked. With the upload zone hidden at
 * art_complete, there was then no way to add the real separation.
 *
 * Fix: approval flows now use artProdFilesConfirmed(), which only honors the
 * explicit checkbox (or an embroidery .dst — that IS the production file).
 * artProdFilesReady() keeps its looser semantics for marking staged jobs complete.
 *
 * SAFE: pure functions from constants.js — no Supabase, no UI, no network.
 */

const { artProdFilesReady, artProdFilesConfirmed } = require('../constants');

describe('artProdFilesConfirmed — explicit gate for skipping the separations stage', () => {
  test('a stray PDF in prod_files is NOT confirmation (the reported bug)', () => {
    const af = { deco_type: 'screen_print', prod_files: [{ url: 'http://x/Stockdale Football Polos.pdf', name: 'Stockdale Football Polos.pdf' }] };
    expect(artProdFilesReady(af)).toBe(true); // looser gate still counts the file
    expect(artProdFilesConfirmed(af)).toBe(false); // approval must not skip the stage
  });

  test('a vector .ai in the production folder is NOT the separation (reported: "Crest Only White.ai")', () => {
    // The system "sees a file located in the production folder and assumes it's THE production file."
    // A vector/mockup .ai is not a print-ready separation, so approval must prompt — not auto-complete.
    const af = { deco_type: 'screen_print', prod_files: [{ url: 'http://x/Crest Only White.ai', name: 'Crest Only White.ai' }] };
    expect(artProdFilesReady(af)).toBe(true); // a file IS present in the folder
    expect(artProdFilesConfirmed(af)).toBe(false); // but it is not confirmed — the gate must open
  });

  test('checked checkbox (prod_files_attached) confirms', () => {
    const af = { deco_type: 'screen_print', prod_files: [], prod_files_attached: true };
    expect(artProdFilesConfirmed(af)).toBe(true);
    expect(artProdFilesReady(af)).toBe(true);
  });

  test('explicitly unchecked checkbox with files present stays unconfirmed', () => {
    const af = { deco_type: 'screen_print', prod_files: ['sep.pdf'], prod_files_attached: false };
    expect(artProdFilesConfirmed(af)).toBe(false);
  });

  test('embroidery .dst counts as the production file — in files or prod_files', () => {
    expect(artProdFilesConfirmed({ deco_type: 'embroidery', files: [{ name: 'logo.DST' }] })).toBe(true);
    expect(artProdFilesConfirmed({ deco_type: 'embroidery', prod_files: [{ name: 'logo.dst' }] })).toBe(true);
  });

  test('embroidery with only a PDF is not confirmed', () => {
    expect(artProdFilesConfirmed({ deco_type: 'embroidery', prod_files: [{ name: 'spec.pdf' }] })).toBe(false);
  });

  test('.dst on a non-embroidery art does not confirm (seps still required)', () => {
    expect(artProdFilesConfirmed({ deco_type: 'screen_print', prod_files: [{ name: 'logo.dst' }] })).toBe(false);
  });

  test('missing/empty art file is never confirmed', () => {
    expect(artProdFilesConfirmed(null)).toBe(false);
    expect(artProdFilesConfirmed({})).toBe(false);
    expect(artProdFilesConfirmed({ deco_type: 'screen_print', prod_files: [] })).toBe(false);
  });
});
