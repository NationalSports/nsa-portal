const {
  buildSoShipmentEmail, buildShipmentLines, pickMockupUrl, emailImageUrl,
  decorationSummary, orderedSizes, trackAllUrl,
} = require('../../netlify/functions/_soShipmentEmail');

// The order the design was drawn against: Bolsa Grande Football, 3 styles,
// 126 pieces, 3 boxes.
const packages = [
  {
    index: 1, trackingNumber: '1Z999AA10123456784', trackingUrl: '', carrier: 'ups', contents: 'Hoodies · 46 pcs',
    items: [{ sku: 'AD-TI4287', name: 'Team Issue Pullover Hoodie', color: 'Navy / White', sizes: { M: 12, S: 6, L: 14, XL: 10, '2XL': 4 } }],
  },
  {
    index: 2, trackingNumber: '1Z999AA10123456793', trackingUrl: '', carrier: 'ups', contents: 'Tees · 56 pcs',
    items: [{ sku: 'UA-1376842', name: 'Team Tech Short Sleeve Tee', color: 'Midnight Navy', sizes: { S: 8, M: 14, L: 16, XL: 12, '2XL': 6 } }],
  },
  {
    index: 3, trackingNumber: '1Z999AA10123456802', trackingUrl: '', carrier: 'ups', contents: 'Caps · 24 pcs',
    items: [{ sku: 'RCH-112', name: '112 Trucker Cap', color: 'Navy / Charcoal', sizes: { OSFA: 24 } }],
  },
];

const soItems = [
  { id: 'i1', sku: 'AD-TI4287', name: 'Team Issue Pullover Hoodie', brand: 'Adidas', color: 'Navy / White' },
  { id: 'i2', sku: 'UA-1376842', name: 'Team Tech Short Sleeve Tee', brand: 'Under Armour', color: 'Midnight Navy' },
  { id: 'i3', sku: 'RCH-112', name: '112 Trucker Cap', brand: 'Richardson', color: 'Navy / Charcoal' },
];

const artFiles = [{
  id: 'af1',
  item_mockups: {
    'AD-TI4287|Navy / White': [{ url: 'https://res.cloudinary.com/nsa/image/upload/v1/hoodie.png', name: 'hoodie.png' }],
  },
  mockup_files: [],
}];

const lines = () => buildShipmentLines({
  packages,
  soItems,
  decorationsByItemId: { i1: [{ kind: 'art', deco_type: 'screen_print', colors: 2, position: 'Left Chest' }] },
  artFiles,
});

const fullEmail = () => buildSoShipmentEmail({
  order: { id: 'NSA-18402' },
  teamName: 'Bolsa Grande Football',
  shipTo: { name: 'Bolsa Grande HS Athletics', line1: '9401 Westminster Ave', city: 'Garden Grove', state: 'CA', zip: '92844' },
  rep: { name: 'Danny Ortiz', phone: '(714) 279-8777', email: 'danny@nationalsportsapparel.com' },
  lines: lines(),
  packages,
  shipDate: 'Sep 21, 2026',
  eta: 'Wed, Sep 24',
  carrier: 'ups',
  portalUrl: 'https://nationalsportsapparel.com/coach?portal=BOLSA&so=NSA-18402',
  reorderUrl: 'https://nationalsportsapparel.com/coach?portal=BOLSA&page=shop',
  logoUrl: 'https://nationalsportsapparel.com/logo.png',
});

describe('shipment line assembly', () => {
  test('rolls box contents up per garment and enriches from the order lines', () => {
    const out = lines();
    expect(out).toHaveLength(3);
    expect(out[0]).toMatchObject({ brand: 'Adidas', name: 'Team Issue Pullover Hoodie', sku: 'AD-TI4287', totalQty: 46 });
    expect(out[1].totalQty).toBe(56);
    expect(out[2].totalQty).toBe(24);
  });

  test('sums the same garment across several boxes', () => {
    const split = [
      { index: 1, items: [{ sku: 'AD-TI4287', name: 'Hoodie', color: 'Navy / White', sizes: { M: 6 } }] },
      { index: 2, items: [{ sku: 'AD-TI4287', name: 'Hoodie', color: 'Navy / White', sizes: { M: 4, L: 2 } }] },
    ];
    const out = buildShipmentLines({ packages: split, soItems, decorationsByItemId: {}, artFiles: [] });
    expect(out).toHaveLength(1);
    expect(out[0].totalQty).toBe(12);
    expect(out[0].sizes).toEqual([{ label: 'M', qty: 10 }, { label: 'L', qty: 2 }]);
  });

  test('keeps custom-blank lines apart — they all share the CUST-SUPPLIED sku, so they key on name', () => {
    const custom = [{
      index: 1,
      items: [
        { sku: 'CUST-SUPPLIED', name: 'Long Sleeve', color: 'Red', sizes: { L: 3 } },
        { sku: 'CUST-SUPPLIED', name: 'Short Sleeve', color: 'Red', sizes: { L: 5 } },
      ],
    }];
    const out = buildShipmentLines({ packages: custom, soItems: [], decorationsByItemId: {}, artFiles: [] });
    expect(out.map((l) => l.totalQty).sort()).toEqual([3, 5]);
  });

  test('drops a box line that shipped zero units', () => {
    const empty = [{ index: 1, items: [{ sku: 'X', name: 'X', color: '', sizes: { M: 0 } }] }];
    expect(buildShipmentLines({ packages: empty, soItems: [], decorationsByItemId: {}, artFiles: [] })).toHaveLength(0);
  });
});

describe('product names', () => {
  const { cleanProductName } = require('../../netlify/functions/_soShipmentEmail');

  test('drops the vendor import’s doubled brand and trailing style number', () => {
    expect(cleanProductName('Sport-Tek Sport-Tek PosiCharge Competitor Tee. ST350', 'Sport-Tek', 'ST350'))
      .toBe('PosiCharge Competitor Tee');
    expect(cleanProductName('Richardson PTS20', 'Richardson', 'PTS20')).toBe('Richardson PTS20'); // nothing left → keep the name
  });

  test('leaves a clean name alone', () => {
    expect(cleanProductName('Team Issue Pullover Hoodie', 'Adidas', 'AD-TI4287')).toBe('Team Issue Pullover Hoodie');
    expect(cleanProductName('112 Trucker Cap', '', '')).toBe('112 Trucker Cap');
  });

  test('is applied when lines are built', () => {
    const out = buildShipmentLines({
      packages: [{ index: 1, items: [{ sku: 'ST350', name: 'Sport-Tek Sport-Tek PosiCharge Competitor Tee. ST350', color: 'Black', sizes: { M: 2 } }] }],
      soItems: [{ id: 'x', sku: 'ST350', name: 'Sport-Tek Sport-Tek PosiCharge Competitor Tee. ST350', brand: 'Sport-Tek', color: 'Black' }],
      decorationsByItemId: {}, artFiles: [],
    });
    expect(out[0].name).toBe('PosiCharge Competitor Tee');
    expect(out[0].brand).toBe('Sport-Tek');
    expect(out[0].sku).toBe('ST350');
  });
});

describe('size display', () => {
  test('orders sizes the way a size run reads, not the way the object was built', () => {
    expect(orderedSizes({ '2XL': 4, S: 6, XL: 10, M: 12, L: 14 }).map((s) => s.label))
      .toEqual(['S', 'M', 'L', 'XL', '2XL']);
  });

  test('keeps an unrecognized size label instead of dropping the units', () => {
    expect(orderedSizes({ M: 2, 'YOUTH-ODD': 3 }).map((s) => s.label)).toEqual(['M', 'YOUTH-ODD']);
  });
});

describe('mockup images', () => {
  test('finds the garment bucket and resizes for email', () => {
    const url = pickMockupUrl(artFiles, soItems[0]);
    expect(url).toContain('/image/upload/q_auto,w_300,c_limit/');
    expect(url).not.toContain('f_auto');
    expect(url).toContain('hoodie.png');
  });

  test('renders a PDF proof as its first page, since inboxes cannot show a PDF', () => {
    const out = emailImageUrl('https://res.cloudinary.com/nsa/image/upload/v1/proof.pdf');
    expect(out).toContain('pg_1,f_png');
  });

  test('ignores a non-image, non-Cloudinary PDF rather than embedding a broken image', () => {
    expect(emailImageUrl('https://example.com/proof.pdf')).toBe('');
  });

  test('refuses a non-http(s) url', () => {
    expect(emailImageUrl('javascript:alert(1)')).toBe('');
  });

  test('falls back to the art file’s generic mockups when the garment has no bucket', () => {
    const generic = [{ id: 'af2', item_mockups: {}, mockup_files: [{ url: 'https://res.cloudinary.com/nsa/image/upload/v1/generic.png' }] }];
    expect(pickMockupUrl(generic, soItems[0])).toContain('generic.png');
  });

  test('never uses a names/numbers proof as the garment mockup', () => {
    const nn = [{ id: 'af3', item_mockups: { 'AD-TI4287|Navy / White|numbers': [{ url: 'https://res.cloudinary.com/nsa/image/upload/v1/numbers.png' }] }, mockup_files: [] }];
    expect(pickMockupUrl(nn, soItems[0])).toBe('');
  });
});

describe('tracking links', () => {
  test('one link covers every box when they all went UPS', () => {
    const url = trackAllUrl(packages);
    expect(url).toContain('ups.com');
    expect(decodeURIComponent(url)).toContain('1Z999AA10123456784,1Z999AA10123456793,1Z999AA10123456802');
  });

  test('mixed carriers fall back to the first box', () => {
    const mixed = [{ index: 1, trackingNumber: '1Z999AA10123456784', carrier: 'ups' }, { index: 2, trackingNumber: '770000000000', carrier: 'fedex' }];
    expect(trackAllUrl(mixed)).toContain('1Z999AA10123456784');
  });

  test('no tracking numbers means no button', () => {
    expect(trackAllUrl([{ index: 1, trackingNumber: '', carrier: 'ups' }])).toBe('');
  });
});

describe('decoration summary', () => {
  test('describes the decoration the way a coach would read it', () => {
    expect(decorationSummary([{ kind: 'art', deco_type: 'screen_print', colors: 2, position: 'Left Chest' }]))
      .toBe('2-color screen print, Left Chest');
  });

  test('collapses duplicates and names names/numbers plainly', () => {
    expect(decorationSummary([
      { kind: 'art', deco_type: 'embroidery', position: 'Left Chest' },
      { kind: 'art', deco_type: 'embroidery', position: 'Left Chest' },
      { kind: 'names' },
    ])).toBe('embroidery, Left Chest &nbsp;&#183;&nbsp; Names');
  });
});

describe('the email itself', () => {
  test('carries the order, the coach, the gear and every box', () => {
    const { subject, html } = fullEmail();
    expect(subject).toBe('Your Bolsa Grande Football order has shipped — NSA-18402');
    expect(html).toContain('Order NSA-18402');
    expect(html).toContain('Shipped Sep 21, 2026');
    expect(html).toContain('3 styles for Bolsa Grande Football left our shop');
    expect(html).toContain('Estimated delivery');
    expect(html).toContain('Wed, Sep 24');
    expect(html).toContain('Team Issue Pullover Hoodie');
    expect(html).toContain('Total 46 pcs');
    expect(html).toContain('2-color screen print, Left Chest');
    packages.forEach((p) => expect(html).toContain(p.trackingNumber));
    expect(html).toContain('Box 1/3');
    expect(html).toContain('Box 3/3');
  });

  test('totals bar states styles, pieces and boxes', () => {
    const { html } = fullEmail();
    const readable = html.replace(/&nbsp;&#183;&nbsp;/g, '·').replace(/\s+/g, ' ');
    expect(readable).toContain('3 styles · 126 pieces · 3 boxes');
  });

  test('holds the brand shell — navy/red rule, tagline, rep block, portal buttons', () => {
    const { html } = fullEmail();
    expect(html).toContain('#192853');
    expect(html).toContain('#962C32');
    expect(html).toContain("California's Largest Independent Team Dealer");
    expect(html).toContain('Danny Ortiz');
    expect(html).toContain('danny@nationalsportsapparel.com');
    expect(html).toContain('Bolsa Grande HS Athletics');
    expect(html).toContain('View Order In Portal');
    expect(html).toContain('Reorder');
    expect(html).toContain('width:600px');
  });

  test('escapes customer text instead of letting it become markup', () => {
    const { subject, html } = buildSoShipmentEmail({
      order: { id: 'NSA-1' },
      teamName: '<script>alert(1)</script>',
      lines: [{ brand: '', name: '"><img src=x>', color: '', sku: '', decoration: '', sizes: [{ label: 'M', qty: 1 }], totalQty: 1, mockupUrl: '' }],
      packages: [{ index: 1, trackingNumber: '1Z1', carrier: 'ups', contents: '' }],
    });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<img src=x>');
    expect(subject).toContain('<script>'); // subject is plain text, not markup
  });

  test('degrades section by section on a thin order — no undefined, no empty buttons', () => {
    const { html } = buildSoShipmentEmail({
      order: { id: 'NSA-2' },
      teamName: 'Orange HS',
      lines: [{ brand: '', name: 'Practice Tee', color: '', sku: '', decoration: '', sizes: [{ label: 'L', qty: 5 }], totalQty: 5, mockupUrl: '' }],
      packages: [{ index: 1, trackingNumber: '', carrier: 'rep_delivery', contents: '' }],
    });
    expect(html).not.toMatch(/undefined|null|NaN/);
    expect(html).not.toContain('Estimated delivery');
    expect(html).not.toContain('View Order In Portal');
    expect(html).toContain('No tracking number');
    expect(html).toContain('1 style &nbsp;&#183;&nbsp; 5 pieces &nbsp;&#183;&nbsp; 1 box');
  });

  test('shows the placeholder panel when a garment has no mockup on file', () => {
    const { html } = buildSoShipmentEmail({
      order: { id: 'NSA-3' },
      lines: [{ brand: '', name: 'Tee', color: '', sku: '', decoration: '', sizes: [{ label: 'M', qty: 1 }], totalQty: 1, mockupUrl: '' }],
      packages: [],
    });
    expect(html).toContain('Mockup<br>Image');
    expect(html).not.toContain('alt="Mockup of');
  });

  test('keeps the mockup beside the details on phones instead of stacking it full-width', () => {
    const { html } = buildSoShipmentEmail({
      order: { id: 'NSA-3' },
      lines: [{ brand: 'Sport-Tek', name: 'Tee', color: 'Black', sku: 'ST350', decoration: '', sizes: [{ label: 'M', qty: 1 }], totalQty: 1, mockupUrl: 'https://res.cloudinary.com/demo/image/upload/v1/a.png' }],
      packages: [],
    });
    const card = html.slice(html.indexOf('alt="Mockup of') - 400, html.indexOf('alt="Mockup of') + 900);
    expect(card).not.toContain('stackcell');
    expect(html).not.toMatch(/\.mock\{/);
  });

  test('each box row lists its garments with color, count and size run', () => {
    const { boxContents } = require('../../netlify/functions/_soShipmentEmail');
    const items = [
      { sku: 'ST350', name: 'Sport-Tek Sport-Tek PosiCharge Competitor Tee. ST350', color: 'Deep Orange', sizes: { L: 25, M: 20, S: 5, XL: 5, '2XL': 5 } },
      { sku: 'RCH-112', name: '112 Trucker Cap', color: '', sizes: { OSFA: 24 } },
      { sku: 'GHOST', name: 'Nothing in the box', color: 'Red', sizes: { M: 0 } },
    ];
    const contentsItems = boxContents(items, (it) => (it.sku === 'ST350' ? 'PosiCharge Competitor Tee' : ''));
    expect(contentsItems).toHaveLength(2);
    expect(contentsItems[0]).toMatchObject({ name: 'PosiCharge Competitor Tee', color: 'Deep Orange', totalQty: 60 });
    expect(contentsItems[0].sizes.map((s) => s.label)).toEqual(['S', 'M', 'L', 'XL', '2XL']);
    const { html } = buildSoShipmentEmail({
      order: { id: 'NSA-5' }, lines: [],
      packages: [{ index: 1, trackingNumber: '1Z999AA10123456784', carrier: 'ups', contentsItems }],
    });
    expect(html).toContain('PosiCharge Competitor Tee &#8212; Deep Orange &#183; 60 pcs');
    expect(html).toContain('S&nbsp;<strong>5</strong> &nbsp; M&nbsp;<strong>20</strong> &nbsp; L&nbsp;<strong>25</strong>');
    expect(html).toContain('112 Trucker Cap &#183; 24 pcs');
    expect(html).not.toContain('Nothing in the box');
  });

  test('says plainly when this is part of the order, and stays quiet when it is all of it', () => {
    const { remainingUnits } = require('../../netlify/functions/_soShipmentEmail');
    const so = [
      { sku: 'AD-TI4287', color: 'Navy / White', sizes: { S: 6, M: 12 } },
      { sku: 'RCH-112', color: 'Navy', sizes: { OSFA: 24 } },
      { sku: 'DIGITIZING', color: '', sizes: null },                       // a service line, never a "piece"
      { sku: 'UA-1376842', color: 'Midnight Navy', sizes: { S: 8, M: 14 } }, // not in any box yet
    ];
    const boxes = [{ items: [{ sku: 'AD-TI4287', color: 'Navy / White', sizes: { S: 6, M: 12 } }, { sku: 'RCH-112', color: 'Navy', sizes: { OSFA: 24 } }] }];
    expect(remainingUnits({ soItems: so, allPackages: boxes })).toBe(22);
    expect(remainingUnits({ soItems: so.slice(0, 3), allPackages: boxes })).toBe(0);
    const partial = buildSoShipmentEmail({ order: { id: 'NSA-6' }, teamName: 'Orange HS', lines: [], packages: [], remainingUnits: 22 }).html;
    expect(partial).toContain('Still to come:</strong> 22 more pieces from this order will ship separately');
    expect(partial).toContain('This is part of your order');
    const whole = buildSoShipmentEmail({ order: { id: 'NSA-7' }, teamName: 'Orange HS', lines: [], packages: [], remainingUnits: 0 }).html;
    expect(whole).not.toContain('Still to come');
    expect(whole).not.toContain('part of your order');
  });

  test('a single box says "Track Your Box", not "All Boxes"', () => {
    const { html } = buildSoShipmentEmail({
      order: { id: 'NSA-4' },
      lines: [],
      packages: [{ index: 1, trackingNumber: '1Z999AA10123456784', carrier: 'ups', contents: '' }],
    });
    expect(html).toContain('Track Your Box');
  });
});
