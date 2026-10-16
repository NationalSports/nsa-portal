import { parseColor, svgColors, svgPalette, withDefaultFill, recolorSvg, recolorPlan, recolorMap, bindInks, removeInkLine, hasArtPicks } from '../lib/svgRecolor';

// Illustrator-style export: classes in a <style> block, plus an inline style and an attribute.
const AI_EXPORT = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs><style>.st0{fill:#1B365D;}.st1{fill:#FFFFFF;stroke:#C8A24A;}</style>
<linearGradient id="g"><stop offset="0" stop-color="#c8a24a"/></linearGradient></defs>
<rect class="st1" width="100" height="100"/><path class="st0" d="M0 0h10v10z"/>
<circle style="fill: rgb(200, 162, 74); opacity:.5" r="4"/><path fill="url(#g)" d="M1 1"/><path fill="none" stroke="#000" d="M2 2"/></svg>`;

describe('parseColor', () => {
  test('hex, short hex, rgb(), percentages, names, alpha', () => {
    expect(parseColor('#ABC')).toEqual({ hex: '#aabbcc', alpha: '' });
    expect(parseColor(' #1b365d ')).toEqual({ hex: '#1b365d', alpha: '' });
    expect(parseColor('#1b365d80')).toEqual({ hex: '#1b365d', alpha: '80' });
    expect(parseColor('rgb(27, 54, 93)')).toEqual({ hex: '#1b365d', alpha: '' });
    expect(parseColor('rgb(100%,0%,0%)').hex).toBe('#ff0000');
    expect(parseColor('White').hex).toBe('#ffffff');
    expect(parseColor('#fff !important').hex).toBe('#ffffff');
  });
  test('non-colors are left alone', () => {
    ['none', 'url(#g)', 'currentColor', 'inherit', '', null].forEach(v => expect(parseColor(v)).toBeNull());
  });
});

describe('svgColors', () => {
  test('lists each distinct color once, in document order, across style block / style attr / attributes', () => {
    expect(svgColors(AI_EXPORT).map(c => c.hex)).toEqual(['#1b365d', '#ffffff', '#c8a24a', '#000000']);
    expect(svgColors(AI_EXPORT).find(c => c.hex === '#c8a24a').uses).toBe(3); // stroke, stop-color, rgb() fill
  });
  test('"stop-color" is not also read as "color"', () => {
    expect(svgColors('<svg><stop stop-color="#123456"/></svg>')).toEqual([{ hex: '#123456', uses: 1 }]);
  });
  test('reads pdf.js namespaced output (<svg:style>, svg:path)', () => {
    const t = '<svg:svg xmlns:svg="http://www.w3.org/2000/svg"><svg:style>.a{fill:#ff0000}</svg:style><svg:path fill="#00ff00"/></svg:svg>';
    expect(svgColors(t).map(c => c.hex)).toEqual(['#ff0000', '#00ff00']);
  });
});

describe('withDefaultFill', () => {
  test('makes the implicit black fill an explicit, swappable color', () => {
    const t = withDefaultFill('<svg:svg xmlns:svg="x" width="10px"><svg:text>Hi</svg:text></svg:svg>');
    expect(t).toContain('<svg:svg xmlns:svg="x" width="10px" fill="#000000">');
    expect(svgColors(t)).toEqual([{ hex: '#000000', uses: 1 }]);
    // pdf.js (converted .ai): black text is a <tspan> with no fill inside a <text>
    expect(withDefaultFill('<svg:svg><svg:text><svg:tspan font-size="1px">A</svg:tspan></svg:text></svg:svg>')).toContain('fill="#000000"');
  });
  test('no phantom black when every shape sets its own fill (attribute, class or style)', () => {
    const t = '<svg><rect fill="#1b365d"/><path class="st0"/><circle style="fill:#fff"/><text><tspan fill="#c8102e">A</tspan></text></svg>';
    expect(withDefaultFill(t)).toBe(t);
  });
  test('leaves a root that already sets fill alone', () => {
    const t = '<svg fill="red"><path/></svg>';
    expect(withDefaultFill(t)).toBe(t);
  });
});

describe('svgPalette', () => {
  test('clean spot-color art keeps every color as its own entry', () => {
    expect(svgPalette(AI_EXPORT).map(g => g.hex)).toEqual(['#1b365d', '#ffffff', '#c8a24a', '#000000']);
  });
  test('all of one color is one entry: whites / off-whites (and blacks) group together, distinct colors stay apart', () => {
    const t = '<svg><path fill="#ffffff"/><path fill="#fdfdfd"/><path fill="#1b365d"/><path fill="#fefefe"/><path fill="#f6f6f6"/>'
      + '<path fill="#000000"/><path fill="#050505"/><path fill="#c8102e"/><path fill="#e6e6e6"/></svg>';
    const pal = svgPalette(t);
    expect(pal.map(g => g.members.slice().sort())).toEqual([
      ['#f6f6f6', '#fdfdfd', '#fefefe', '#ffffff'], ['#1b365d'], ['#000000', '#050505'], ['#c8102e'], ['#e6e6e6']]);
    // One pick on the white group changes every white in the file.
    const out = recolorSvg(t, recolorMap(pal, { inks: ['Gold'], art_recolor: { [pal[0].hex]: 0 } }, [], () => '#ffb81c'));
    expect(svgColors(out).map(c => c.hex)).toEqual(['#ffb81c', '#1b365d', '#000000', '#050505', '#c8102e', '#e6e6e6']);
    expect(recolorSvg(t, recolorMap(pal, { inks: [], art_recolor: { [pal[0].hex]: 'drop' } }, [], () => null))).not.toMatch(/#f[6def]f[6def]f[6def]|#ffffff/);
  });
  test('traced art with hundreds of near-identical shades is grouped down to the cap', () => {
    const paths = [];
    for (let i = 0; i < 200; i++) paths.push(`<path fill="#${(i % 20).toString(16).padStart(2, '0').repeat(3)}"/>`); // near-blacks
    for (let i = 0; i < 200; i++) paths.push(`<path fill="#${(235 + (i % 20)).toString(16).repeat(3)}"/>`); // near-whites
    const pal = svgPalette('<svg>' + paths.join('') + '</svg>', 12);
    expect(pal.length).toBeLessThanOrEqual(12);
    expect(pal.reduce((n, g) => n + g.members.length, 0)).toBe(40); // every shade lands in exactly one group
  });
});

describe('recolorSvg', () => {
  test('swaps only color values and keeps alpha / !important / gradients', () => {
    const out = recolorSvg(AI_EXPORT, { '#1B365D': '#8a1538', '#c8a24a': '#ffffff' });
    expect(out).toContain('.st0{fill:#8a1538;}');
    expect(out).toContain('stroke:#ffffff;');
    expect(out).toContain('stop-color="#ffffff"');
    expect(out).toContain('style="fill: #ffffff; opacity:.5"');
    expect(out).toContain('fill="url(#g)"');
    expect(out).toContain('fill="none" stroke="#000"'); // unmapped color untouched
    expect(recolorSvg('<svg><path fill="#ff000080"/></svg>', { '#ff0000': '#00ff00' })).toContain('fill="#00ff0080"');
  });
  test('drop-out: fill/stroke become none, other color props transparent', () => {
    const out = recolorSvg(AI_EXPORT, { '#ffffff': 'none', '#c8a24a': 'none' });
    expect(out).toContain('.st1{fill:none;stroke:none;}');
    expect(out).toContain('stop-color="transparent"');
    expect(svgColors(out).map(c => c.hex)).toEqual(['#1b365d', '#000000']);
  });
  test('no map → identical text', () => {
    expect(recolorSvg(AI_EXPORT, {})).toBe(AI_EXPORT);
  });
});

describe('recolorPlan / recolorMap', () => {
  const pal = [{ hex: '#1b365d', members: ['#1b365d', '#1c375e'] }, { hex: '#ffffff', members: ['#ffffff'] }, { hex: '#c8a24a', members: ['#c8a24a'] }];
  const hex = n => ({ Maroon: '#8a1538', Gold: '#ffd700', White: '#ffffff' }[n] || null);
  test('default: every color stays as is until a rep picks an ink, whatever the ink list holds', () => {
    expect(recolorPlan(pal, { inks: ['Maroon', 'Gold', 'White'] })).toEqual({ '#1b365d': -1, '#ffffff': -1, '#c8a24a': -1 });
    expect(recolorMap(pal, { inks: ['Maroon', 'Gold', 'White'] }, [], hex)).toEqual({});
  });
  test("the color way's own pick wins, including keep (-1) and drop", () => {
    const cw = { inks: ['Maroon', 'Gold'], art_recolor: { '#1b365d': 1, '#ffffff': 'drop', '#c8a24a': -1 } };
    expect(recolorPlan(pal, cw)).toEqual({ '#1b365d': 1, '#ffffff': 'drop', '#c8a24a': -1 });
  });
  test('drop-outs (session ones for art with no color way, or a color way\'s art_drop) always win', () => {
    expect(recolorPlan(pal, null, ['#ffffff'])).toEqual({ '#1b365d': -1, '#ffffff': 'drop', '#c8a24a': -1 });
    expect(recolorPlan(pal, { inks: ['Maroon', 'Gold'] }, ['#ffffff'])['#ffffff']).toBe('drop');
    expect(recolorPlan(pal, { inks: ['Maroon', 'Gold'], art_recolor: { '#ffffff': 1 } }, ['#ffffff'])['#ffffff']).toBe('drop');
  });
  test('a pick pointing at a removed / empty ink line falls back to keep', () => {
    expect(recolorPlan(pal, { inks: ['Maroon'], art_recolor: { '#ffffff': 3 } })['#ffffff']).toBe(-1);
  });
  test('recolorMap expands groups to every member shade; unknown ink names keep the file color', () => {
    expect(recolorMap(pal, { inks: ['Maroon', 'Mystery'], art_recolor: { '#1b365d': 0, '#ffffff': 1, '#c8a24a': 'drop' } }, [], hex))
      .toEqual({ '#1b365d': '#8a1538', '#1c375e': '#8a1538', '#c8a24a': 'none' });
  });
});

describe('ink lines drive the recolor (bindInks / removeInkLine / art_drop)', () => {
  // The Lick-Wilmerding tiger: gray detail, gold, dark, white.
  const pal = [{ hex: '#a5afae', members: ['#a5afae'] }, { hex: '#ffb11c', members: ['#ffb11c'] }, { hex: '#2c2e35', members: ['#2c2e35'] }, { hex: '#ffffff', members: ['#ffffff'] }];
  const hex = n => ({ 'PMS 123': '#ffc72c', 'PMS White': '#ffffff', 'PMS Black': '#2d2926', 'PMS 186': '#c8102e' }[n] || null);
  test('each ink line links to the closest art color; colors no line matches stay unlinked', () => {
    expect(bindInks(pal, { inks: ['PMS Black', 'PMS 123', 'PMS White'] }, hex)).toEqual({ '#2c2e35': 0, '#ffb11c': 1, '#ffffff': 2 });
    expect(bindInks(pal, { inks: ['PMS 123', 'PMS White'] }, hex)).toEqual({ '#ffb11c': 0, '#ffffff': 1 });
    expect(bindInks(pal, { inks: ['PMS 186'] }, hex)).toBeNull(); // red matches nothing in the art
    expect(bindInks(pal, { inks: ['Mystery'] }, hex)).toBeNull();
  });
  test('a linked line keeps its link when retyped — so changing the ink recolors that part of the art', () => {
    const cw = { inks: ['PMS 186', 'PMS White'], art_recolor: { '#ffb11c': 0, '#ffffff': 1 } }; // was PMS 123
    expect(bindInks(pal, cw, hex)).toBeNull();
    expect(recolorMap(pal, cw, [], hex)).toEqual({ '#ffb11c': '#c8102e', '#ffffff': '#ffffff' });
  });
  test('only new lines link, to colors not taken; old keep (-1) values from the dropdown era are free again', () => {
    const cw = { inks: ['PMS 123', 'PMS White', 'PMS Black'], art_recolor: { '#ffb11c': 0, '#ffffff': 1, '#2c2e35': -1 } };
    expect(bindInks(pal, cw, hex)).toEqual({ '#ffb11c': 0, '#ffffff': 1, '#2c2e35': 2 });
  });
  test('removing a line unlinks its color and shifts later links up', () => {
    const cw = { inks: ['PMS Black', 'PMS 123', 'PMS White'], art_recolor: { '#2c2e35': 0, '#ffb11c': 1, '#ffffff': 2, '#a5afae': 'drop' } };
    expect(removeInkLine(cw, 0)).toEqual({ inks: ['PMS 123', 'PMS White'], art_recolor: { '#ffb11c': 0, '#ffffff': 1, '#a5afae': 'drop' } });
    expect(removeInkLine({ inks: ['a', 'b'] }, 1)).toEqual({ inks: ['a'] });
  });
  test('art_drop drops a color without losing its link; hasArtPicks sees links and drops', () => {
    const cw = { inks: ['PMS 123', 'PMS White'], art_recolor: { '#ffb11c': 0, '#ffffff': 1 }, art_drop: ['#ffffff'] };
    expect(recolorPlan(pal, cw)).toEqual({ '#a5afae': -1, '#ffb11c': 0, '#2c2e35': -1, '#ffffff': 'drop' });
    expect(recolorPlan(pal, { ...cw, art_drop: [] })['#ffffff']).toBe(1);
    expect(hasArtPicks(cw)).toBe(true);
    expect(hasArtPicks({ inks: ['PMS 123'], art_drop: ['#ffffff'] })).toBe(true);
    expect(hasArtPicks({ inks: ['PMS 123'], art_recolor: { '#ffffff': -1 } })).toBe(false);
    expect(hasArtPicks(null)).toBe(false);
  });
});
