const test = require('node:test');
const assert = require('node:assert/strict');
const {
  extractCatalogImages,
  splitColorwaySku,
  urlMatchesColor,
} = require('../netlify/functions/_momentecCatalogImages');

const product = (Images) => ({ productInfo: [{ productOrDesignNumber: '790', Images }] });

test('reads the current Momentec front and back fields for the exact colorway', () => {
  const data = product({
    front: 'https://static.momentecbrands.com/product/790_060_front.jpg',
    back: 'https://static.momentecbrands.com/product/790_060_back.jpg',
    lquarter: 'https://static.momentecbrands.com/product/790_060_lquarter.jpg',
  });

  assert.deepEqual(extractCatalogImages(data, '790.060'), {
    front: 'https://static.momentecbrands.com/product/790_060_front.jpg',
    back: 'https://static.momentecbrands.com/product/790_060_back.jpg',
  });
});

test('does not assign the catalog hero color to a different colorway', () => {
  const data = product({
    front: 'https://static.momentecbrands.com/product/790_060_front.jpg',
    back: 'https://static.momentecbrands.com/product/790_060_back.jpg',
    heroImage: 'https://static.momentecbrands.com/product/790_060_lquarter.jpg',
  });

  assert.deepEqual(extractCatalogImages(data, '790.030'), { front: null, back: null });
});

test('prefers flat current-shape images for a legacy design-level product', () => {
  const data = product({
    lquarter: 'https://static.momentecbrands.com/product/790_060_lquarter.jpg',
    heroImage: 'https://static.momentecbrands.com/product/790_060_lquarter.jpg',
    back: 'https://static.momentecbrands.com/product/790_060_back.jpg',
    front: 'https://static.momentecbrands.com/product/790_060_front.jpg',
  });

  assert.deepEqual(extractCatalogImages(data, '790'), {
    front: 'https://static.momentecbrands.com/product/790_060_front.jpg',
    back: 'https://static.momentecbrands.com/product/790_060_back.jpg',
  });
});

test('continues to support the older imageURL response shape', () => {
  const data = product({
    imageURL: 'https://static.momentecbrands.com/product/9582_280.jpg',
  });

  assert.deepEqual(extractCatalogImages(data, '9582'), {
    front: 'https://static.momentecbrands.com/product/9582_280.jpg',
    back: null,
  });
});

test('rejects no-picture sentinels and validates color codes case-insensitively', () => {
  assert.deepEqual(extractCatalogImages(product({
    imageURL: 'https://static.momentecbrands.com/product/NoPicture.jpg',
  }), '790'), { front: null, back: null });
  assert.equal(urlMatchesColor('https://cdn.test/790_f253_FRONT.jpg', '790', 'F253'), true);
  assert.deepEqual(splitColorwaySku('790.F253'), { design: '790', colorCode: 'F253' });
});

test('worker preserves live images and writes only color-safe catalog fills', async () => {
  const worker = require('../netlify/functions/_background-workers/momentec-image-verify-background');
  const oldFetch = global.fetch;
  const oldUrl = process.env.REACT_APP_SUPABASE_URL;
  const oldKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const patches = [];
  process.env.REACT_APP_SUPABASE_URL = 'https://database.test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';

  const rows = [
    {
      id: 'keep-live',
      sku: '790.030',
      image_front_url: 'https://existing.test/790%20030_front.jpg',
      image_back_url: 'https://existing.test/790_030_back.jpg',
    },
    { id: 'fill-legacy', sku: '754A', image_front_url: null, image_back_url: null },
    { id: 'reject-wrong-color', sku: '790.030', image_front_url: null, image_back_url: null },
  ];
  const catalogs = {
    '754A': {
      productInfo: [{ Images: {
        front: 'https://static.momentecbrands.com/product/754A_F253_front.jpg',
        back: 'https://static.momentecbrands.com/product/754A_F253_back.jpg',
      } }],
    },
    '790': {
      productInfo: [{ Images: {
        front: 'https://static.momentecbrands.com/product/790_060_front.jpg',
        back: 'https://static.momentecbrands.com/product/790_060_back.jpg',
      } }],
    },
  };

  try {
    global.fetch = async (url, init = {}) => {
      const value = String(url);
      if (value.startsWith('https://database.test/rest/v1/products?select=')) {
        return { ok: true, json: async () => rows };
      }
      if (value.startsWith('https://database.test/rest/v1/products?id=eq.')) {
        patches.push(JSON.parse(init.body));
        return { ok: true };
      }
      if (value === 'https://api.momentecbrands.com/v2/Style') {
        const design = JSON.parse(init.body).productOrDesignNumber;
        return { ok: true, json: async () => catalogs[design] };
      }
      if (value.startsWith('https://existing.test/')) {
        assert.doesNotMatch(value, /%25(?:20|5F)/);
        return { status: 206 };
      }
      if (/_F253_(?:front|back)\.jpg$/.test(value)) return { status: 206 };
      return { status: 404 };
    };

    const response = await worker.handler({
      queryStringParameters: { brand: 'Momentec', dryRun: 'true', concurrency: '3' },
    });
    const summary = JSON.parse(response.body);
    assert.equal(response.statusCode, 200);
    assert.equal(summary.rows_planned, 1);
    assert.equal(summary.rows_written, 0);
    assert.equal(summary.fronts_preserved, 1);
    assert.equal(summary.backs_preserved, 1);
    assert.deepEqual(patches, []);

    const writeResponse = await worker.handler({
      queryStringParameters: { brand: 'Momentec', concurrency: '3' },
    });
    assert.equal(JSON.parse(writeResponse.body).rows_written, 1);
    assert.deepEqual(patches, [{
      image_front_url: 'https://static.momentecbrands.com/product/754A_F253_front.jpg',
      image_back_url: 'https://static.momentecbrands.com/product/754A_F253_back.jpg',
    }]);
  } finally {
    global.fetch = oldFetch;
    if (oldUrl === undefined) delete process.env.REACT_APP_SUPABASE_URL;
    else process.env.REACT_APP_SUPABASE_URL = oldUrl;
    if (oldKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    else process.env.SUPABASE_SERVICE_ROLE_KEY = oldKey;
  }
});
