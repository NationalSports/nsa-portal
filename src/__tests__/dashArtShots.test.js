// dashArtShots — the mock images behind the dashboard's inline "Art awaiting approval"
// preview. What this pins down:
//   • per-garment mockups resolve per line, labelled sku · color
//   • the generic mockup_files bucket only stands in for art with NO per-item mocks
//   • art with no mockup at all falls back to the raw design art, flagged hasMock:false
//     (the SO-1661 rule: a design file must never be presented as an approved proof)
//   • production formats a browser can't draw (.ai/.eps/.dst) never enter the gallery
//   • the same file referenced twice renders once

jest.mock('html2pdf.js', () => ({ __esModule: true, default: () => ({ from: () => ({ save: () => {} }) }) }));
jest.mock('jspdf', () => ({ __esModule: true, jsPDF: class {} }));
jest.mock('svg2pdf.js', () => ({ __esModule: true, svg2pdf: () => {} }));
jest.mock('fabric', () => ({ __esModule: true, Canvas: class {}, Rect: class {}, Image: class {} }));
jest.mock('tesseract.js', () => ({ __esModule: true, createWorker: () => ({}) }));
jest.mock('barcode-detector', () => ({ __esModule: true, BarcodeDetector: class {} }));
jest.mock('imagetracerjs', () => ({ __esModule: true, default: { imagedataToSVG: () => '' } }));
jest.mock('xlsx', () => ({ __esModule: true, read: () => ({}), utils: {}, writeFile: () => {} }));

import { dashArtShots } from '../App';

const IMG = n => 'https://res.cloudinary.com/x/image/upload/v1/' + n + '.png';

// One SO line decorated with one art file; the job owns that line.
const makeSO = (artFiles, { sku = 'A325', color = 'Navy', sizes = { M: 10, L: 14 } } = {}) => ({
  id: 'SO-1',
  items: [{ sku, color, name: 'Tee', decorations: [{ kind: 'art', art_file_id: artFiles[0].id }], sizes }],
  art_files: artFiles,
  jobs: [],
});
const makeJob = (artFiles, { sku = 'A325', color = 'Navy', sizes = { M: 10, L: 14 } } = {}) => ({
  id: 'j1', art_name: 'Panthers Baseball', deco_type: 'screen_print',
  art_file_id: artFiles[0].id, _art_ids: artFiles.map(a => a.id),
  items: [{ item_idx: 0, sku, color, sizes }],
});

describe('dashArtShots', () => {
  test('returns nothing for a missing job or order', () => {
    expect(dashArtShots(null, { id: 'SO-1' }).shots).toEqual([]);
    expect(dashArtShots({ id: 'j1' }, null).hasMock).toBe(false);
  });

  test('per-garment mockups render, labelled sku · color, with units counted', () => {
    const art = [{ id: 'af1', deco_type: 'screen_print', ink_colors: 'Navy, Gold',
      item_mockups: { 'A325|Navy': [{ url: IMG('mock-front'), name: 'front.png' }] } }];
    const r = dashArtShots(makeJob(art), makeSO(art));
    expect(r.hasMock).toBe(true);
    expect(r.shots.map(s => s.url)).toEqual([IMG('mock-front')]);
    expect(r.shots[0].label).toBe('A325 · Navy');
    expect(r.shots[0].kind).toBe('mock');
    expect(r.units).toBe(24);
    expect(r.garments).toEqual([{ sku: 'A325', color: 'Navy', name: 'Tee', qty: 24 }]);
  });

  test('generic mockup_files stand in when the art carries no per-item mocks', () => {
    const art = [{ id: 'af1', mockup_files: [{ url: IMG('generic') }], item_mockups: {} }];
    const r = dashArtShots(makeJob(art), makeSO(art));
    expect(r.hasMock).toBe(true);
    expect(r.shots.map(s => s.label)).toEqual(['Design mockup']);
  });

  test('no mockup anywhere → the raw design art, flagged as not a proof', () => {
    const art = [{ id: 'af1', files: [{ url: IMG('logo-art') }], mockup_files: [], item_mockups: {} }];
    const r = dashArtShots(makeJob(art), makeSO(art));
    expect(r.hasMock).toBe(false);
    expect(r.shots.map(s => s.kind)).toEqual(['design']);
    expect(r.shots[0].label).toBe('Design art');
  });

  test('formats a browser cannot draw are skipped', () => {
    const art = [{ id: 'af1', mockup_files: [
      { url: 'https://res.cloudinary.com/x/raw/upload/v1/proof.ai' },
      { url: 'https://res.cloudinary.com/x/raw/upload/v1/stitch.dst' },
    ], item_mockups: {} }];
    expect(dashArtShots(makeJob(art), makeSO(art)).shots).toEqual([]);
  });

  test('a file reached by two paths renders once', () => {
    const dupe = { url: IMG('same'), name: 'same.png' };
    const art = [{ id: 'af1', item_mockups: { 'A325|Navy': [dupe, { ...dupe }] } }];
    expect(dashArtShots(makeJob(art), makeSO(art)).shots).toHaveLength(1);
  });
});
