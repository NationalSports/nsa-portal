import { stitchPreviewsFor, stitchSourceFor, threadLinesMissingMsg } from '../DstPreview';
import { dstThreadOrderKey, hasConfirmedDstThreadOrder } from '../lib/dstThreadOrder';
import { stitchLogoNeedsSave } from '../lib/logoDetail';

const url = 'https://example.com/biola.dst';
const legacy = { id: 'biola', deco_type: 'embroidery', prod_files: [{ url }],
  color_ways: [{id:'blue', garment_color:'on blue', inks:['White', 'Red']}],
  mockup_files: [{url:'rep-proof.png'}], web_logos: [{url:'rep-logo.png',color_way_id:'blue'}] };

test('old job prints no inferred DST colors, fetches nothing and preserves the rep data', async () => {
  global.fetch = jest.fn();
  const before = JSON.stringify(legacy);
  expect(await stitchPreviewsFor([legacy])).toEqual({});
  expect(stitchSourceFor(legacy, 'blue')).toBeNull();
  expect(await threadLinesMissingMsg([legacy])).toBe('');
  expect(stitchLogoNeedsSave(legacy, 'blue', ['White','Red'])).toBe(false);
  expect(global.fetch).not.toHaveBeenCalled();
  expect(JSON.stringify(legacy)).toBe(before);
});

test('matching color counts alone never confirm sewing order', () => {
  expect(hasConfirmedDstThreadOrder(legacy.color_ways[0], url)).toBe(false);
});

test('explicit confirmation is bound to the exact DST and thread sequence', () => {
  const cw = legacy.color_ways[0];
  const confirmed = {...cw, dst_thread_order:dstThreadOrderKey(cw,url)};
  expect(stitchSourceFor({...legacy,color_ways:[confirmed]}, 'blue')).toMatchObject({dstUrl:url,inks:['White','Red']});
  expect(hasConfirmedDstThreadOrder(confirmed,'https://example.com/replacement.dst')).toBe(false);
  expect(hasConfirmedDstThreadOrder({...confirmed,inks:['Red','White']},url)).toBe(false);
});
