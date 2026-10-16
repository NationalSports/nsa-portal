/* eslint-disable */
/**
 * buildProdSheetOpts — the printed Production Job Sheet groups garments by decoration.
 *
 * Denis (GM): items getting the same logo printed on separate pages, and an item's mockup
 * could land on a different page from its details. Garments sharing a decoration now print
 * as ONE section (combined size table, mockups/logo beside the spec), one page per group.
 *
 * SAFE: pure builder only — no Supabase, no network.
 */
import { buildProdSheetOpts } from '../App';
import { garmentMockKey } from '../safeHelpers';

const art = {
  id: 'AF1', name: 'DAWGS Script', deco_type: 'screen_print', art_size: '11in',
  color_ways: [{ id: 'cwW', garment_color: 'Navy', inks: ['PMS White', 'PMS 200C'] }, { id: 'cwN', garment_color: 'White', inks: ['Navy'] }],
  item_mockups: {},
};
const crest = cw => ({ kind: 'art', position: 'Front', art_file_id: 'AF1', color_way_id: cw });
const TEE = { sku: 'JI8266', name: 'Impact Tee', color: 'Navy', sizes: { S: 4, M: 12 }, decorations: [crest('cwW')] };
const HOOD = { sku: 'HF7212', name: 'Fleece Hoodie', color: 'Navy', sizes: { M: 6, L: 8 }, decorations: [crest('cwW')] };
const WHITE = { sku: 'JI8266', name: 'Impact Tee', color: 'White', sizes: { M: 5 }, decorations: [crest('cwN')] };
const JERSEY = { sku: 'JM5134', name: 'Jersey', color: 'Navy', sizes: { M: 2, L: 1 },
  decorations: [crest('cwW'), { kind: 'numbers', position: 'Back', num_size: '8in', print_color: 'White', roster: { M: ['1', '2'], L: ['14'] } }] };

const build = items => {
  const a = { ...art, item_mockups: Object.fromEntries(items.map(it => [garmentMockKey(it), ['https://res.cloudinary.com/x/image/upload/v1/' + it.sku + '-' + it.color + '.png']])) };
  const so = { id: 'SO-1', customer_id: 'C1', items, art_files: [a] };
  const j = { id: 'JOB-1', deco_type: 'screen_print', art_file_id: 'AF1', total_units: 0,
    items: items.map((it, i) => ({ item_idx: i, deco_idxs: it.decorations.map((_, di) => di) })) };
  return buildProdSheetOpts(j, so, {}).notes;
};
const sections = html => (html.match(/page-break-after:always/g) || []).length + 1;

test('SKUs with the same logo and colors print as one section with a combined size table', () => {
  const html = build([TEE, HOOD]);
  expect(sections(html)).toBe(1);
  expect(html).toContain('Group total');
  expect(html).toContain('same logo &amp; colors');
  expect(html).toContain('For: JI8266 (Navy)');
  expect(html).toContain('For: HF7212 (Navy)');
  // the logo detail / spec print once for the pair
  expect(html.match(/Decoration Spec/g)).toHaveLength(1);
});

test('a different ink color way or a numbers setup starts its own page', () => {
  const html = build([TEE, WHITE, HOOD, JERSEY]);
  expect(sections(html)).toBe(3);
  expect(html).toContain('Decoration 1 of 3');
  expect(html).toContain('Number List — JM5134 (Navy)');
  // grouped garments are listed together even when the job lists them apart
  const first = html.split('<div style="page-break-after:always">')[1];
  expect(first).toContain('HF7212');
  expect(first).not.toContain('(White)');
});

test('mockup and logo sit beside the size table inside one keep-together block', () => {
  const html = build([TEE]);
  const block = html.slice(html.indexOf('break-inside:avoid'));
  expect(block.indexOf('JI8266-Navy.png')).toBeGreaterThan(-1);
  expect(block.indexOf('JI8266-Navy.png')).toBeLessThan(block.indexOf('Decoration Spec'));
  expect(html).toContain('Decorated by');
  expect(html).toContain('QC by');
});

test('embroidery: threads print numbered in sew order and the stitch preview sits with the logo details', () => {
  const emb = { id: 'AF2', name: 'Bulldog', deco_type: 'embroidery', art_size: '3in', item_mockups: {},
    color_ways: [{ id: 'cw1', garment_color: 'Navy', inks: ['White', 'Navy Blue (17)', 'Dark Green (1)', 'White'] }] };
  const POLO = { sku: 'P1', name: 'Polo', color: 'Navy', sizes: { M: 3 }, decorations: [{ kind: 'art', position: 'Left Chest', art_file_id: 'AF2' }] };
  const so = { id: 'SO-2', customer_id: 'C1', items: [POLO], art_files: [emb] };
  const j = { id: 'JOB-2', deco_type: 'embroidery', art_file_id: 'AF2', total_units: 3, items: [{ item_idx: 0, deco_idxs: [0] }] };
  const html = buildProdSheetOpts(j, so, { stitchPreviews: { 'AF2|cw1': { url: 'data:image/png;base64,STITCH', garment: 'Navy' } } }).notes;
  // single color way = this deco's color way: every stop, repeats included, numbered
  ['<b>1.</b> White', '<b>2.</b> Navy Blue (17)', '<b>3.</b> Dark Green (1)', '<b>4.</b> White'].forEach(t => expect(html).toContain(t));
  expect(html).toContain('data:image/png;base64,STITCH');
  expect(html).toContain('Stitch preview — Bulldog · CW: Navy');
  // without a render (DST unreachable) the sheet still builds, just without the image
  expect(buildProdSheetOpts(j, so, {}).notes).not.toContain('Stitch preview');
});

test('legacy Biola job keeps rep proof and White/Red list without inferred DST preview', async () => {
  const { stitchPreviewsFor } = require('../DstPreview');
  const emb = { id:'biola', name:'Biola Volleyball 2 color', deco_type:'embroidery',
    prod_files:[{url:'https://example.com/biola.dst'}], mockup_files:[{url:'rep-approved-biola.png'}],
    color_ways:[{id:'blue',garment_color:'on blue',inks:['White','Red']}] };
  const so = {id:'SO-1535',items:[{sku:'CCRC0',color:'Chambray',sizes:{OSFA:1},decorations:[{kind:'art',position:'Front Center',art_file_id:'biola',color_way_id:'blue'}]}],art_files:[emb]};
  const j = {id:'JOB-1535-01-A',art_file_id:'biola',deco_type:'embroidery',total_units:1,items:[{item_idx:0,deco_idxs:[0]}]};
  const html = buildProdSheetOpts(j,so,{stitchPreviews:await stitchPreviewsFor(so.art_files)}).notes;
  expect(html).toContain('rep-approved-biola.png');
  expect(html).toContain('<b>1.</b> White');
  expect(html).toContain('<b>2.</b> Red');
  expect(html).not.toContain('Stitch preview');
});
