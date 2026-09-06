/* eslint-disable */
/**
 * Production files are per DESIGN, not per job (SO-2145).
 *
 * The reported job: one long-sleeve tee carrying a screen-printed front ("PAL Front")
 * and a DTF sleeve ("ALL TOURNAMENT"). buildJobs deliberately keeps mixed decoration
 * methods on ONE job — one tech sheet, one trip across the floor — but each design
 * still owes its own production file: a color separation for the print, ordered films
 * for the DTF, a DST for embroidery.
 *
 * The bug: the order page classified the whole job by its PRIMARY art's deco_type and
 * then stamped prod_files_attached on EVERY art file the job touched. So the rep saw a
 * single "Order DTF Transfers" to-do, clicked "Films Ordered — Mark Complete", and the
 * screen-print separation — which nobody had made — was silently marked done. The job
 * went to production with no seps. The banner even read "3 production files attached"
 * while the print design had none of them.
 *
 * The fix: pendingProdFileGroups splits the job's live art into the method buckets that
 * still owe a file (one banner block each), artStatusAfterProdConfirm re-derives the
 * job's stage from what is STILL owed, and approveArtOnSO's stampProd accepts an id
 * subset so confirming one method never confirms the others.
 *
 * SAFE: pure functions from constants.js / lib/artReview.js — no Supabase, no UI, no network.
 */

const {
  prodFileMethodOf, pendingProdFileGroups, artStatusAfterProdConfirm,
  artProdFilesConfirmed, artDstOnFile, PROD_FILE_METHOD_ORDER,
} = require('../constants');
const { approveArtOnSO } = require('../lib/artReview');

// The real SO-2145 shape: PAL front is screen print with an order PDF sitting in its
// production folder (a PDF is NOT a separation), the sleeve is DTF and not yet ordered.
const PAL_FRONT = {
  id: 'af-pal', name: 'PAL Front', deco_type: 'screen_print', status: 'approved',
  prod_files: [{ name: 'PAL Shirts (2).pdf' }],
};
const SLEEVE = {
  id: 'af-tourney', name: 'ALL TOURNAMENT', deco_type: 'dtf', status: 'approved',
  prod_files: [{ name: 'PAL Shirts (1).pdf' }, { name: 'All TOurnament Sleeve.ai' }],
};
const MIXED = [PAL_FRONT, SLEEVE];

describe('prodFileMethodOf — which production file a design owes', () => {
  test('buckets each decoration method', () => {
    expect(prodFileMethodOf({ deco_type: 'screen_print' })).toBe('print');
    expect(prodFileMethodOf({ deco_type: 'dtf' })).toBe('dtf');
    expect(prodFileMethodOf({ deco_type: 'heat_press' })).toBe('dtf'); // same ordered film
    expect(prodFileMethodOf({ deco_type: 'embroidery' })).toBe('embroidery');
    expect(prodFileMethodOf({ deco_type: 'vinyl' })).toBe('print'); // anything else = a drawn file
  });

  test('falls back to the job deco when the art carries none', () => {
    expect(prodFileMethodOf({}, 'dtf')).toBe('dtf');
    expect(prodFileMethodOf(null, 'embroidery')).toBe('embroidery');
    expect(prodFileMethodOf(null, null)).toBe('print');
  });
});

describe('pendingProdFileGroups — one to-do per method still owing a file', () => {
  test('the reported job asks for BOTH the separation and the films', () => {
    const groups = pendingProdFileGroups(MIXED, 'dtf');
    expect(groups.map((g) => g.method)).toEqual(['print', 'dtf']); // print first: longest lead
    expect(groups[0].ids).toEqual(['af-pal']);
    expect(groups[1].ids).toEqual(['af-tourney']);
  });

  test('a PDF in the production folder does not clear a design (the SO-2145 read)', () => {
    // Both designs have files sitting in prod_files. Neither is a confirmed separation.
    expect(PAL_FRONT.prod_files.length + SLEEVE.prod_files.length).toBe(3);
    expect(pendingProdFileGroups(MIXED, 'dtf')).toHaveLength(2);
  });

  test('a confirmed design drops out, the unconfirmed one stays', () => {
    const dtfDone = [PAL_FRONT, { ...SLEEVE, prod_files_attached: true }];
    const groups = pendingProdFileGroups(dtfDone, 'dtf');
    expect(groups).toHaveLength(1);
    expect(groups[0].method).toBe('print');
    expect(groups[0].arts[0].name).toBe('PAL Front');
  });

  test('nothing owed = no blocks', () => {
    const allDone = MIXED.map((a) => ({ ...a, prod_files_attached: true }));
    expect(pendingProdFileGroups(allDone, 'dtf')).toEqual([]);
    expect(pendingProdFileGroups([], 'dtf')).toEqual([]);
    expect(pendingProdFileGroups(null, 'dtf')).toEqual([]);
  });

  test('two designs of the SAME method share one block', () => {
    const twoPrints = [PAL_FRONT, { ...PAL_FRONT, id: 'af-back', name: 'PAL Back' }];
    const groups = pendingProdFileGroups(twoPrints, 'screen_print');
    expect(groups).toHaveLength(1);
    expect(groups[0].ids).toEqual(['af-pal', 'af-back']);
  });

  test('blocks come back in a stable order whatever order the art is in', () => {
    const a = pendingProdFileGroups(MIXED, 'dtf').map((g) => g.method);
    const b = pendingProdFileGroups([SLEEVE, PAL_FRONT], 'dtf').map((g) => g.method);
    expect(a).toEqual(b);
    expect(PROD_FILE_METHOD_ORDER).toEqual(['print', 'dtf', 'embroidery']);
  });

  test('approve-time callers may count a live .dst (approving IS the sign-off)', () => {
    const emb = { id: 'af-emb', deco_type: 'embroidery', status: 'needs_approval', prod_files: [{ name: 'DG648617.dst' }] };
    const loose = (x) => artProdFilesConfirmed(x) || artDstOnFile(x);
    expect(pendingProdFileGroups([emb], 'embroidery')).toHaveLength(1); // strict: not approved yet
    expect(pendingProdFileGroups([emb], 'embroidery', loose)).toEqual([]); // approve-time: the DST is the file
  });
});

describe('artStatusAfterProdConfirm — the job only completes when NOTHING is owed', () => {
  test('ordering the DTF films leaves the job waiting on the print separation', () => {
    // This is the exact click that used to send the job to the floor with no seps.
    expect(artStatusAfterProdConfirm(MIXED, ['af-tourney'], 'dtf')).toBe('production_files_needed');
  });

  test('making the separation first leaves the job waiting on the films', () => {
    expect(artStatusAfterProdConfirm(MIXED, ['af-pal'], 'dtf')).toBe('order_dtf_transfers');
  });

  test('both confirmed = art_complete', () => {
    expect(artStatusAfterProdConfirm(MIXED, ['af-pal', 'af-tourney'], 'dtf')).toBe('art_complete');
  });

  test('a single-method job still completes on its one confirmation (no regression)', () => {
    expect(artStatusAfterProdConfirm([PAL_FRONT], ['af-pal'], 'screen_print')).toBe('art_complete');
    expect(artStatusAfterProdConfirm([SLEEVE], ['af-tourney'], 'dtf')).toBe('art_complete');
  });

  test('confirming nothing leaves the job in the outstanding stage', () => {
    expect(artStatusAfterProdConfirm(MIXED, [], 'dtf')).toBe('production_files_needed');
    expect(artStatusAfterProdConfirm([SLEEVE], [], 'dtf')).toBe('order_dtf_transfers');
  });

  test('embroidery still owed routes to the DST stage', () => {
    const emb = { id: 'af-emb', deco_type: 'embroidery', status: 'approved' };
    expect(artStatusAfterProdConfirm([{ ...PAL_FRONT, prod_files_attached: true }, emb], [], 'screen_print'))
      .toBe('upload_emb_files');
  });
});

describe('approveArtOnSO — a confirmation must not stamp designs it did not answer for', () => {
  const so = () => ({
    id: 'SO-2145',
    jobs: [{ id: 'JOB-2145-01', art_status: 'order_dtf_transfers' }],
    art_files: [{ ...PAL_FRONT }, { ...SLEEVE }],
  });
  const job = (jj) => jj.id === 'JOB-2145-01';
  const byId = (out, id) => out.art_files.find((a) => a.id === id);

  test('stampProd as an ID LIST confirms only those designs (the fix)', () => {
    const out = approveArtOnSO(so(), {
      match: job, artIds: ['af-pal', 'af-tourney'],
      targetStatus: 'production_files_needed', stampProd: ['af-tourney'],
    });
    expect(byId(out, 'af-tourney').prod_files_attached).toBe(true);
    expect(byId(out, 'af-pal').prod_files_attached).toBeUndefined(); // separation still owed
    expect(artProdFilesConfirmed(byId(out, 'af-pal'))).toBe(false);
    expect(out.jobs[0].art_status).toBe('production_files_needed');
  });

  test('both art files still move to approved — only the CONFIRMATION is scoped', () => {
    const out = approveArtOnSO(so(), {
      match: job, artIds: ['af-pal', 'af-tourney'],
      targetStatus: 'production_files_needed', stampProd: ['af-tourney'],
    });
    expect(byId(out, 'af-pal').status).toBe('approved');
    expect(byId(out, 'af-tourney').status).toBe('approved');
  });

  test('stampProd true still stamps everything (single-method jobs unchanged)', () => {
    const out = approveArtOnSO(so(), {
      match: job, artIds: ['af-pal', 'af-tourney'], targetStatus: 'art_complete', stampProd: true,
    });
    expect(byId(out, 'af-pal').prod_files_attached).toBe(true);
    expect(byId(out, 'af-tourney').prod_files_attached).toBe(true);
  });

  test('an empty list stamps nothing', () => {
    const out = approveArtOnSO(so(), {
      match: job, artIds: ['af-pal', 'af-tourney'], targetStatus: 'production_files_needed', stampProd: [],
    });
    expect(byId(out, 'af-pal').prod_files_attached).toBeUndefined();
    expect(byId(out, 'af-tourney').prod_files_attached).toBeUndefined();
  });

  test('end to end: films ordered, then the separation — only the second click completes the job', () => {
    const afterFilms = approveArtOnSO(so(), {
      match: job, artIds: ['af-pal', 'af-tourney'],
      targetStatus: artStatusAfterProdConfirm(so().art_files, ['af-tourney'], 'dtf'),
      stampProd: ['af-tourney'],
    });
    expect(afterFilms.jobs[0].art_status).toBe('production_files_needed');

    const afterSeps = approveArtOnSO(afterFilms, {
      match: job, artIds: ['af-pal'],
      targetStatus: artStatusAfterProdConfirm(afterFilms.art_files, ['af-pal'], 'dtf'),
      stampProd: ['af-pal'],
    });
    expect(afterSeps.jobs[0].art_status).toBe('art_complete');
    expect(afterSeps.art_files.every((a) => a.prod_files_attached === true)).toBe(true);
  });
});

describe('artApproveTarget — the dashboard routes to the method still owed', () => {
  const { artApproveTarget } = require('../lib/artReview');

  test('a mixed job whose DTF is done routes to the PRINT separation, not the films', () => {
    // The primary art (what the job's deco_type says) is the DTF — already ordered.
    const files = [PAL_FRONT, { ...SLEEVE, prod_files_attached: true }];
    expect(artApproveTarget(files, 'dtf'))
      .toEqual({ allConfirmed: false, targetStatus: 'production_files_needed' });
  });

  test('a mixed job whose print is done routes to the films', () => {
    const files = [{ ...PAL_FRONT, prod_files_attached: true }, SLEEVE];
    expect(artApproveTarget(files, 'screen_print').targetStatus).toBe('order_dtf_transfers');
  });

  test('single-method jobs are unchanged', () => {
    expect(artApproveTarget([PAL_FRONT], 'screen_print').targetStatus).toBe('production_files_needed');
    expect(artApproveTarget([SLEEVE], 'dtf').targetStatus).toBe('order_dtf_transfers');
    expect(artApproveTarget([], 'screen_print')).toEqual({ allConfirmed: true, targetStatus: 'art_complete' });
  });

  test('a dangling art id still falls back to the job deco (never vacuously complete)', () => {
    const out = artApproveTarget([{ ...PAL_FRONT, prod_files_attached: true }, undefined], 'embroidery');
    expect(out).toEqual({ allConfirmed: false, targetStatus: 'upload_emb_files' });
  });
});
