import { vectorSourceFor, artRenderSig, artLogoReady } from '../VectorPreview';
import { artLogoNeedsSave, setLogoDetail } from '../lib/logoDetail';

const cdn = p => 'https://res.cloudinary.com/x/image/upload/' + p;

describe('vectorSourceFor — which file the art preview draws', () => {
  test('skips separations files and picks the design .ai (the Lick-Wilmerding folder)', () => {
    const art = { deco_type: 'screen_print', files: [], prod_files: [
      { url: cdn('a.png'), name: 'Screenshot.png' },
      { url: cdn('lw.ai'), name: 'LW on White.ai' },
      { url: cdn('seps.ai'), name: '10.50 IN Lick-Wilmerding High School · SO-2742 · screen print · Front Center seps.ai' },
    ] };
    expect(vectorSourceFor(art)).toEqual({ url: cdn('lw.ai'), name: 'LW on White.ai', kind: 'ai' });
  });
  test('an .ai whose SVG the portal saved loads that SVG (no re-conversion), still named for the .ai', () => {
    const art = { deco_type: 'dtf', prod_files: [
      { url: cdn('lw.ai'), name: 'LW on White.ai' },
      { url: cdn('lw.svg'), name: 'LW on White.svg', from_ai: cdn('lw.ai') },
    ] };
    expect(vectorSourceFor(art)).toEqual({ url: cdn('lw.svg'), name: 'LW on White.ai', kind: 'svg', fromAi: cdn('lw.ai') });
  });
  test('the newest design file wins: a revised .ai uploaded after an SVG is used', () => {
    const art = { deco_type: 'screen_print', prod_files: [{ url: cdn('old.svg'), name: 'old.svg' }, { url: cdn('new.ai'), name: 'new.ai' }] };
    expect(vectorSourceFor(art).url).toBe(cdn('new.ai'));
  });
  test('no preview for embroidery, stale files, seps-only folders or non-URL entries', () => {
    expect(vectorSourceFor({ deco_type: 'embroidery', prod_files: [{ url: cdn('a.ai'), name: 'a.ai' }] })).toBeNull();
    expect(vectorSourceFor({ deco_type: 'screen_print', prod_files: [{ url: cdn('a.ai'), name: 'a.ai', stale: true }] })).toBeNull();
    expect(vectorSourceFor({ deco_type: 'screen_print', prod_files: [{ url: cdn('s.ai'), name: 'Front seps.ai' }] })).toBeNull();
    expect(vectorSourceFor({ deco_type: 'screen_print', prod_files: ['new_file_1.ai'] })).toBeNull();
  });
});

describe('auto web logo for art renders', () => {
  const src = { url: cdn('lw.svg'), fromAi: cdn('lw.ai') };
  const art = { palette: [{ hex: '#ffffff', members: ['#ffffff'] }, { hex: '#ffb81c', members: ['#ffb81c'] }] };
  test('artRenderSig names the design file and each color outcome, so it changes exactly with the render', () => {
    const cw = { id: 'c1', inks: ['PMS 123', 'PMS White'], art_recolor: { '#ffffff': 0, '#ffb81c': 'drop' } };
    expect(artRenderSig(src, art, cw)).toBe(cdn('lw.ai') + '|#ffffff=PMS 123,#ffb81c=drop');
    expect(artRenderSig(src, art, { ...cw, inks: ['PMS 186', 'PMS White'] })).not.toBe(artRenderSig(src, art, cw));
    expect(artLogoReady(cw)).toBe(true);
    expect(artLogoReady({ id: 'c2', inks: ['PMS 123'] })).toBe(false);
  });
  test('artLogoNeedsSave: saves once picked, re-saves its own render on change, never replaces a hand-uploaded logo', () => {
    const cw = { id: 'c1', garment_color: 'Black', inks: ['PMS 123'], art_recolor: { '#ffffff': 0 } };
    const base = { id: 'a1', color_ways: [cw], web_logos: [] };
    expect(artLogoNeedsSave(base, 'c1', 'sig1')).toBe(true);
    expect(artLogoNeedsSave({ ...base, color_ways: [{ ...cw, art_recolor: {} }] }, 'c1', 'sig1')).toBe(false); // nothing picked yet
    const [withAuto] = setLogoDetail([base], 'a1', 'c1', { url: cdn('r1.png'), name: 'Art render — Black', art_sig: 'sig1' });
    expect(withAuto.web_logos[0].art_sig).toBe('sig1');
    expect(artLogoNeedsSave(withAuto, 'c1', 'sig1')).toBe(false);
    expect(artLogoNeedsSave(withAuto, 'c1', 'sig2')).toBe(true);
    const [withRep] = setLogoDetail([base], 'a1', 'c1', { url: cdn('rep.png'), name: 'cutout.png' });
    expect(artLogoNeedsSave(withRep, 'c1', 'sig2')).toBe(false);
    expect(artLogoNeedsSave({ ...withAuto, archived: true }, 'c1', 'sig2')).toBe(false);
  });
});
