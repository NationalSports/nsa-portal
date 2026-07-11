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
 * Update: a .dst is proof the embroidery production file is on the row, so it
 * confirms even when prod_files_attached was never checked — but ONLY while the
 * art file's CURRENT art is signed off (status === 'approved'). A recall/update
 * flips the file to waiting_for_art without stripping the old .dst, and the
 * direct approve gates (Approve Artwork, moveArtStatus, coach approve) call this
 * check without consulting status — an ungated .dst let the STALE stitch file
 * skip the separations re-check (2026-07-10 audit A2, regression from 93401d1).
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

  test('embroidery .dst on APPROVED art counts as the production file — in files or prod_files', () => {
    expect(artProdFilesConfirmed({ deco_type: 'embroidery', status: 'approved', files: [{ name: 'logo.DST' }] })).toBe(true);
    expect(artProdFilesConfirmed({ deco_type: 'embroidery', status: 'approved', prod_files: [{ name: 'logo.dst' }] })).toBe(true);
  });

  test('embroidery .dst on approved art confirms even when prod_files_attached was never checked / is false', () => {
    // The DST is the production file; an unchecked checkbox must not veto a legit one. Matches buildJobs.
    expect(artProdFilesConfirmed({ deco_type: 'embroidery', status: 'approved', prod_files_attached: false, prod_files: [{ name: 'DG-374031.DST' }] })).toBe(true);
    expect(artProdFilesConfirmed({ deco_type: 'embroidery', status: 'approved', prod_files_attached: false, files: [{ name: 'logo.dst' }] })).toBe(true);
  });

  test('AUDIT A2 regression: a stale .dst on pulled-back (non-approved) art must NOT confirm', () => {
    // Recall/Update flip the art file to waiting_for_art (and the redo cycles through
    // needs_approval) but never strip the old .dst — the direct approve gates call this
    // check without a status guard, so the check itself must enforce it.
    expect(artProdFilesConfirmed({ deco_type: 'embroidery', status: 'waiting_for_art', prod_files_attached: false, prod_files: [{ name: 'DG-374031.DST' }] })).toBe(false);
    expect(artProdFilesConfirmed({ deco_type: 'embroidery', status: 'needs_approval', prod_files: [{ name: 'logo.dst' }] })).toBe(false);
    // The explicit checkbox still confirms regardless of status — that's a human attestation.
    expect(artProdFilesConfirmed({ deco_type: 'embroidery', status: 'waiting_for_art', prod_files_attached: true })).toBe(true);
  });

  test('embroidery with prod_files_attached false and NO dst is still unconfirmed', () => {
    expect(artProdFilesConfirmed({ deco_type: 'embroidery', status: 'approved', prod_files_attached: false, prod_files: [{ name: 'spec.pdf' }] })).toBe(false);
  });

  test('embroidery with only a PDF is not confirmed', () => {
    expect(artProdFilesConfirmed({ deco_type: 'embroidery', status: 'approved', prod_files: [{ name: 'spec.pdf' }] })).toBe(false);
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
