import {
  buildTimedTeamSoArtDecorations,
  createTimedTeamDecorationLookup,
  groupTimedTeamLines,
  timedTeamDecorationReview,
  timedTeamLineTreatment,
  timedTeamMockCatalog,
  timedTeamOverrideSkuCodes,
} from '../lib/timedTeamBatch';
import fs from 'fs';
import path from 'path';
const checkout = require('../../netlify/functions/webstore-checkout');

const deco = (art_id, extra = {}) => ({ art_id, art_url: `${art_id}.png`, placement: 'left_chest', side: 'front', ...extra });
const listing = (id, product_id, color, decoration) => ({ id, store_id: 'servite', kind: 'single', active: true, retail_price: 20, product_id, sku: 'ssb-2000', color, display_name: 'Gildan 2000 Tee', decorations: [decoration] });
const fakeCheckoutDb = (products) => ({
  from(table) {
    const result = table === 'webstore_products' ? { data: products, error: null } : { data: [], error: null };
    const chain = { select: () => chain, eq: () => chain, in: () => chain, order: () => chain,
      then: (resolve, reject) => Promise.resolve(result).then(resolve, reject) };
    return chain;
  },
});

describe('timed team batch — immutable purchased listing treatment', () => {
  const friarsBlack = deco('friars', { cw_by_color: { black: { url: 'friars-black.png', color_way_id: 'cw-black' } } });
  const blockBlack = deco('block');
  const crestWhite = deco('crest');
  const friarsGrey = deco('friars', { art_url: 'friars-grey.png', color_way_id: 'cw-grey', cw_by_color: { 'athletic heather': { color_way_id: 'cw-black' } } });
  const catalog = [
    listing('friars-black', 'ssb-2000-50', 'Black', friarsBlack),
    listing('block-black', 'ssb-2000-50', 'Black', blockBlack),
    listing('crest-white', 'ssb-2000-white', 'White', crestWhite),
    listing('friars-grey', 'ssb-2000-grey', 'Athletic Heather', friarsGrey),
  ];
  const cart = [
    { webstore_product_id: 'friars-black', color: 'Black', size: 'S', qty: 2 },
    { webstore_product_id: 'friars-black', color: 'Black', size: 'M', qty: 1 },
    { webstore_product_id: 'block-black', color: 'Black', size: 'M', qty: 3 },
    { webstore_product_id: 'block-black', color: 'Black', size: 'L', qty: 1 },
    { webstore_product_id: 'crest-white', color: 'White', size: 'S', qty: 1 },
    { webstore_product_id: 'friars-grey', color: 'Athletic Heather', size: 'M', qty: 2 },
    { webstore_product_id: 'friars-grey', color: 'Athletic Heather', size: 'XL', qty: 1 },
  ];

  test('Servite-like checkout and conversion keep listings, sizes, review counts, art and explicit color ways separate', async () => {
    const priced = await checkout.priceCart(fakeCheckoutDb(catalog), { id: 'servite', org_type: 'team', fundraise_enabled: false }, cart);
    expect(priced.error).toBeUndefined();
    const lines = checkout.buildOrderItems(priced.lines, null, undefined, false, true)
      .map((orderLine, index) => ({ ...orderLine, id: `order-item-${index}`, order_id: index < 4 ? 'black-orders' : 'other-orders' }));
    const lookup = createTimedTeamDecorationLookup(catalog);
    const groups = Object.values(groupTimedTeamLines(lines, (orderLine) => ({
      source_product_id: orderLine.product_id,
      product_id: orderLine.product_id,
      sku: orderLine.sku,
      color: orderLine.color,
      collected: orderLine.unit_price * orderLine.qty,
      unitCollected: orderLine.unit_price,
      treatment: timedTeamLineTreatment(orderLine, lookup),
    })));

    expect(groups).toHaveLength(4);
    expect(Object.fromEntries(groups.map((group) => [group.webstore_product_id, group.sizes]))).toEqual({
      'friars-black': { S: 2, M: 1 },
      'block-black': { M: 3, L: 1 },
      'crest-white': { S: 1 },
      'friars-grey': { M: 2, XL: 1 },
    });
    expect(timedTeamDecorationReview(lines, lookup).map(({ key, units }) => [key, units])).toEqual([
      ['friars', 6],
      ['block', 4],
      ['crest', 1],
    ]);

    const artById = {
      friars: { id: 'friars', name: 'FRIARS', deco_type: 'screen_print', color_ways: [{ id: 'cw-black', garment_color: 'Black' }, { id: 'cw-grey', garment_color: 'Grey' }] },
      block: { id: 'block', name: 'Block', deco_type: 'screen_print', color_ways: [{ id: 'block-black', garment_color: 'Black' }] },
      crest: { id: 'crest', name: 'Crest', deco_type: 'embroidery', color_ways: [{ id: 'crest-white', garment_color: 'White' }] },
    };
    const built = Object.fromEntries(groups.map((group) => [
      group.webstore_product_id,
      buildTimedTeamSoArtDecorations({ decorations: group.decorations, garmentColor: group.color, artById, decorationUrl: (d) => d.art_url }),
    ]));
    Object.values(built).forEach((result) => expect(result.decorations).toHaveLength(1));
    expect(built['friars-black'].decorations[0]).toMatchObject({ art_file_id: 'friars', color_way_id: 'cw-black' });
    expect(built['block-black'].decorations[0]).toMatchObject({ art_file_id: 'block', color_way_id: 'block-black' });
    expect(built['crest-white'].decorations[0]).toMatchObject({ art_file_id: 'crest', color_way_id: 'crest-white' });
    expect(built['friars-grey'].decorations[0]).toMatchObject({ art_file_id: 'friars', color_way_id: 'cw-grey', web_url: 'friars-grey.png' });
  });

  test('legacy single-logo rows with neither new field convert exactly through the product-id-first fallback', () => {
    const logo = deco('legacy-logo');
    const legacyCatalog = [listing('legacy-listing', 'legacy-product', 'Navy', logo)];
    const lookup = createTimedTeamDecorationLookup(legacyCatalog);
    const legacyLines = [
      { product_id: 'legacy-product', sku: 'ssb-2000', color: 'Navy', size: 'S', qty: 2, unit_price: 20 },
      { product_id: 'legacy-product', sku: 'ssb-2000', color: 'Navy', size: 'M', qty: 1, unit_price: 20 },
    ];
    const groups = Object.values(groupTimedTeamLines(legacyLines, (orderLine) => ({
      source_product_id: orderLine.product_id,
      product_id: orderLine.product_id,
      sku: orderLine.sku,
      color: orderLine.color,
      collected: orderLine.unit_price * orderLine.qty,
      unitCollected: orderLine.unit_price,
      treatment: timedTeamLineTreatment(orderLine, lookup),
    })));
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ webstore_product_id: null, sizes: { S: 2, M: 1 }, decorations: [logo] });
    const built = buildTimedTeamSoArtDecorations({
      decorations: groups[0].decorations,
      garmentColor: 'Navy',
      artById: { 'legacy-logo': { id: 'legacy-logo', deco_type: 'screen_print', color_ways: [{ id: 'legacy-navy', garment_color: 'Navy' }] } },
      decorationUrl: (decoration) => decoration.art_url,
    });
    expect(built.decorations).toEqual([expect.objectContaining({ art_file_id: 'legacy-logo', color_way_id: 'legacy-navy' })]);
  });

  test('purchase snapshot survives later listing deletion with exact treatment identity', () => {
    const purchased = deco('deleted-listing-logo', { color_way_id: 'deleted-cw' });
    const lookup = createTimedTeamDecorationLookup([]);
    const treatment = timedTeamLineTreatment({
      webstore_product_id: 'deleted-listing',
      product_id: 'shared-blank',
      decoration_snapshot: {
        version: 1, decorations: [purchased], takes_name: true, takes_number: false, transfer_codes: ['DELETED-LOGO'], size_skus: { XL: 'DELETED-XL' },
      },
    }, lookup, { 'shared-blank': { num: true, name: false } }, { 'shared-blank': new Set(['OTHER-LOGO']) });
    expect(treatment).toEqual(expect.objectContaining({
      webstore_product_id: 'deleted-listing',
      decorations: [purchased],
      personalize: { num: false, name: true },
      transferCodes: ['DELETED-LOGO'],
      sizeSkus: { XL: 'DELETED-XL' },
    }));
    expect(timedTeamOverrideSkuCodes([{
      webstore_product_id: 'deleted-listing',
      product_id: 'shared-blank',
      size: 'XL',
      decoration_snapshot: {
        version: 1, decorations: [purchased], takes_name: true, takes_number: false, transfer_codes: ['DELETED-LOGO'], size_skus: { XL: { sku: 'DELETED-XL', vendor_id: 'deleted-vendor' } },
      },
    }], { lookup })).toEqual(['DELETED-XL']);
    expect(timedTeamMockCatalog({
      webstoreProductId: 'deleted-listing',
      lookup,
      catalog: [listing('remaining-block-listing', 'shared-blank', 'Navy', deco('wrong-block-logo'))],
      sourceProductId: 'shared-blank',
      sku: 'ssb-2000',
    })).toEqual({ catalog: {}, ambiguous: true });
  });

  test('migration is additive and leaves both purchase fields nullable', () => {
    const sql = fs.readFileSync(path.join(__dirname, '../../supabase/migrations/20261014051938_preserve_timed_team_listing_identity.sql'), 'utf8');
    expect(sql).toMatch(/add column if not exists webstore_product_id uuid/);
    expect(sql).toMatch(/add column if not exists decoration_snapshot jsonb/);
    expect(sql).not.toMatch(/references public\.webstore_products/);
    expect(sql).toMatch(/webstore_order_items_webstore_product_id_idx/);
    expect(sql).not.toMatch(/webstore_product_id uuid\s+(not null|default)/i);
    expect(sql).not.toMatch(/decoration_snapshot jsonb\s+(not null|default)/i);
  });
});
