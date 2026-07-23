/* Blanket smoke suite over every file in netlify/functions/.
 *
 * Today ~90 of the ~122 files there have zero test coverage: an import-time
 * crash (typo, missing require, bad top-level env access) or a missing
 * `handler` export would ship straight to prod with nothing failing CI.
 * This suite doesn't test business logic — it just proves each file loads
 * under Node and (for non-underscore files) exports a `handler` function,
 * then pokes that handler once with a minimal event to catch obvious
 * synchronous crashes.
 *
 * Functions are enumerated at test time via fs.readdirSync, so new files
 * dropped into netlify/functions/ are automatically covered without
 * touching this file.
 *
 * Heavy SDKs are mocked so requiring a function never reaches out over the
 * network or needs real credentials: @supabase/supabase-js, stripe,
 * @anthropic-ai/sdk, puppeteer-core, @sparticuz/chromium, jszip, pdf-lib.
 * A battery of harmless fake env vars covers every process.env.* read found
 * across netlify/functions/*.js (see the audit in this repo's task notes).
 */

const fs = require('fs');
const path = require('path');

const FUNCTIONS_DIR = path.join(__dirname, '..', '..', 'netlify', 'functions');

// ── Fake env: harmless values for every env var read anywhere under
// netlify/functions/, so no module-load-time env check trips. ──
process.env.SUPABASE_URL = 'https://test.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
process.env.REACT_APP_SUPABASE_URL = 'https://test.supabase.co';
process.env.REACT_APP_SUPABASE_ANON_KEY = 'test-anon-key';
process.env.STRIPE_SECRET_KEY = 'sk_test_x';
process.env.STRIPE_PUBLISHABLE_KEY = 'pk_test_x';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
process.env.STRIPE_MAX_AMOUNT_CENTS = '100000000';
process.env.REACT_APP_STRIPE_PK = 'pk_test_x';
process.env.ANTHROPIC_API_KEY = 'test-anthropic-key';
process.env.BREVO_API_KEY = 'test-brevo-key';
process.env.REACT_APP_BREVO_API_KEY = 'test-brevo-key';
process.env.CATALOG_ORDER_EMAIL = 'catalog@example.com';
process.env.CA_DEFAULT_TAX_RATE = '0.0725';
process.env.COMMISSION_REPORT_EMAIL = 'commission@example.com';
process.env.DESIGN_REQUEST_EMAIL = 'design@example.com';
process.env.EMB_MACHINE_TOKEN = 'test-emb-token';
process.env.EMPLOYEE_FORMS_FOLDER_ID = 'test-folder-id';
process.env.EMPLOYER_ADDRESS = '123 Test St';
process.env.EMPLOYER_LEGAL_NAME = 'Test Co';
process.env.EMPLOYER_PAYDAY = 'Friday';
process.env.EMPLOYER_PHONE = '555-555-5555';
process.env.FOLLOWUP_UNSUB_SECRET = 'test-followup-secret';
process.env.GOOGLE_SA_EMAIL = 'sa@example.com';
process.env.GOOGLE_SA_PRIVATE_KEY = '-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----\n';
process.env.INTERNAL_FUNCTION_SECRET = 'test-internal-secret';
process.env.MOMENTEC_API_KEY = 'test-momentec-key';
process.env.MOMENTEC_LOGON_ID = 'test-logon';
process.env.MOMENTEC_PASSWORD = 'test-pw';
process.env.MOMENTEC_STORE_ID = 'test-store';
process.env.MOMENTEC_V2_ENV = 'test';
process.env.NSA_LOGO_URL = 'https://example.com/logo.png';
process.env.NSA_ORIGIN_ADDRESS = '123 Test St';
process.env.NSA_ORIGIN_CITY = 'Testville';
process.env.NSA_ORIGIN_STATE = 'CA';
process.env.NSA_ORIGIN_ZIP = '90000';
process.env.OMG_API_BASE_URL = 'https://omg.example.com';
process.env.OMG_API_KEY = 'test-omg-key';
process.env.ONBOARDING_ENC_KEY = '0123456789abcdef0123456789abcdef';
process.env.ONBOARDING_HR_EMAIL = 'hr@example.com';
process.env.ONBOARDING_WELCOME_URL = 'https://example.com/welcome';
process.env.OPS_DIGEST_TEST_KEY = 'test-ops-key';
process.env.PORTAL_ASSET_URL = 'https://example.com/assets';
process.env.PORTAL_PUBLIC_URL = 'https://example.com';
process.env.PROD_SCAN_TOKEN = 'test-prod-scan-token';
process.env.PUBLIC_URL = 'https://example.com';
process.env.QB_CLIENT_ID = 'test-qb-client-id';
process.env.QB_CLIENT_SECRET = 'test-qb-client-secret';
process.env.QB_REDIRECT_URI = 'https://example.com/qb/callback';
process.env.RICHARDSON_API_BASE_URL = 'https://richardson.example.com';
process.env.RICHARDSON_API_KEY = 'test-richardson-key';
process.env.RICHARDSON_FEED_KEY = 'test-richardson-feed-key';
process.env.RICHARDSON_FEED_URL = 'https://richardson.example.com/feed';
process.env.RICHARDSON_FEED_USER = 'test-richardson-user';
process.env.SANMAR_BRAND_STYLES = 'STYLE1,STYLE2';
process.env.SANMAR_CUSTOMER_NUMBER = 'test-customer-number';
process.env.SANMAR_NIKE_STYLES = 'NIKE1,NIKE2';
process.env.SANMAR_PASSWORD = 'test-sanmar-pw';
process.env.SANMAR_USERNAME = 'test-sanmar-user';
process.env.SHIPSTATION_API_KEY = 'test-ss-key';
process.env.SHIPSTATION_API_SECRET = 'test-ss-secret';
process.env.SHIPSTATION_WEBHOOK_SECRET = 'test-ss-webhook-secret';
process.env.SITE_URL = 'https://example.com';
process.env.SPORTSLINK_API_BASE_URL = 'https://sportslink.example.com';
process.env.SPORTSLINK_API_KEY = 'test-sportslink-key';
process.env.SPORTSLINK_DIGEST_EMAIL = 'sportslink@example.com';
process.env.SPORTSLINK_SINCE_DATE = '2020-01-01';
process.env.SS_ACCOUNT_NUMBER = 'test-ss-account';
process.env.SS_API_KEY = 'test-ss-api-key';
process.env.SS_DIGEST_EMAIL = 'ssdigest@example.com';
process.env.SS_ORDERS_BASE_URL = 'https://ss-orders.example.com';
process.env.SS_ORDERS_SINCE_DATE = '2020-01-01';
process.env.STORES_ALERT_EMAIL = 'stores@example.com';
process.env.STUCK_SWEEP_ALERT_EMAIL = 'stuck@example.com';
process.env.SYSTEM_HEALTH_ALERT_EMAIL = 'health@example.com';
process.env.TAX_COLLECT_STATES = 'CA,NY';
process.env.URL = 'https://example.com';
process.env.VECTORIZER_AI_API_ID = 'test-vectorizer-id';
process.env.VECTORIZER_AI_API_SECRET = 'test-vectorizer-secret';
process.env.VENDOR_DIGITIZING_TOKEN = 'test-vendor-digitizing-token';
process.env.WORKERS_COMP_CARRIER = 'Test Carrier';

// ── Mock heavy SDKs so require() never touches the network or needs real
// credentials. Kept intentionally minimal — just enough surface for
// module-load time and a single no-op handler invocation to succeed. ──
jest.mock('@supabase/supabase-js', () => {
  const chain = {
    select: () => chain,
    insert: () => chain,
    update: () => chain,
    upsert: () => chain,
    delete: () => chain,
    eq: () => chain,
    neq: () => chain,
    in: () => chain,
    is: () => chain,
    ilike: () => chain,
    like: () => chain,
    gt: () => chain,
    gte: () => chain,
    lt: () => chain,
    lte: () => chain,
    or: () => chain,
    not: () => chain,
    contains: () => chain,
    order: () => chain,
    limit: () => chain,
    range: () => chain,
    single: () => Promise.resolve({ data: null, error: null }),
    maybeSingle: () => Promise.resolve({ data: null, error: null }),
    then: (resolve) => Promise.resolve({ data: [], error: null }).then(resolve),
  };
  const fakeClient = {
    from: () => chain,
    rpc: () => Promise.resolve({ data: null, error: null }),
    auth: {
      getUser: () => Promise.resolve({ data: { user: null }, error: null }),
      admin: {
        createUser: () => Promise.resolve({ data: null, error: null }),
        deleteUser: () => Promise.resolve({ data: null, error: null }),
        inviteUserByEmail: () => Promise.resolve({ data: null, error: null }),
      },
    },
    storage: {
      from: () => ({
        upload: () => Promise.resolve({ data: null, error: null }),
        download: () => Promise.resolve({ data: null, error: null }),
        getPublicUrl: () => ({ data: { publicUrl: 'https://example.com/x' } }),
      }),
    },
  };
  return { createClient: () => fakeClient };
});

jest.mock('stripe', () => {
  const factory = function StripeMock() {
    return {
      paymentIntents: { create: () => Promise.resolve({}), retrieve: () => Promise.resolve({}) },
      webhooks: { constructEvent: () => ({ type: 'test', data: { object: {} } }) },
      checkout: { sessions: { create: () => Promise.resolve({}) } },
      customers: { create: () => Promise.resolve({}) },
      refunds: { create: () => Promise.resolve({}) },
    };
  };
  return factory;
});

jest.mock('@anthropic-ai/sdk', () => function AnthropicMock() {
  return { messages: { create: () => Promise.resolve({ content: [] }) } };
});

jest.mock('puppeteer-core', () => ({
  launch: () => Promise.resolve({
    newPage: () => Promise.resolve({
      setContent: () => Promise.resolve(),
      pdf: () => Promise.resolve(Buffer.from('')),
      close: () => Promise.resolve(),
    }),
    close: () => Promise.resolve(),
  }),
}));

jest.mock('@sparticuz/chromium', () => ({
  executablePath: () => Promise.resolve('/usr/bin/fake-chromium'),
  args: [],
  defaultViewport: null,
  headless: true,
}));

jest.mock('jszip', () => function JSZipMock() {
  return {
    file: () => {},
    folder: () => ({ file: () => {} }),
    generateAsync: () => Promise.resolve(Buffer.from('')),
  };
});

jest.mock('pdf-lib', () => ({
  PDFDocument: {
    create: () => Promise.resolve({
      addPage: () => ({ drawText: () => {}, drawImage: () => {}, getSize: () => ({ width: 612, height: 792 }) }),
      embedFont: () => Promise.resolve({}),
      embedPng: () => Promise.resolve({}),
      embedJpg: () => Promise.resolve({}),
      save: () => Promise.resolve(Buffer.from('')),
    }),
    load: () => Promise.resolve({
      getPages: () => [{ drawText: () => {}, getSize: () => ({ width: 612, height: 792 }) }],
      save: () => Promise.resolve(Buffer.from('')),
    }),
  },
  StandardFonts: { Helvetica: 'Helvetica', HelveticaBold: 'Helvetica-Bold' },
  rgb: () => ({}),
}));

// Outbound HTTP is not part of what this suite is testing, and this sandbox
// has no network egress — an unmocked fetch would fail with a jsdom/undici
// "Network request failed" TypeError that looks exactly like a real bug but
// is really just the environment. Stub a generic ok-ish response so pass 2
// exercises each handler's own logic instead of the network layer.
//
// Plain function, not jest.fn(): CRA's jest config sets resetMocks:true,
// which would wipe a factory-time mockImplementation (and any implementation
// assigned once at module scope, like this) back to a no-op before every
// test — see teamshopAssistant.test.js for the same gotcha.
global.fetch = () => Promise.resolve({
  ok: true,
  status: 200,
  // An empty array, not `{}`: several functions hit Supabase's PostgREST
  // directly with plain fetch() (bypassing @supabase/supabase-js) and
  // spread/.map() the parsed body, e.g. `rows.push(...await r.json())` in
  // ups-pickup-sync.js. List endpoints return JSON arrays in production, so
  // `[]` is the more representative empty response; `{}` isn't iterable and
  // trips a spread TypeError that's an artifact of this mock, not a real bug.
  json: () => Promise.resolve([]),
  text: () => Promise.resolve(''),
  arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
  headers: { get: () => null },
});

// Files that genuinely cannot be required under this suite's mocking, with
// the one-line reason each was excluded. Keep this list as small as
// possible — every addition here is a file with zero load-time coverage.
const SKIP = new Set([
  // (none at present — every netlify/functions/*.js file loads cleanly
  // under the mocks above.)
]);

function listFunctionFiles() {
  return fs.readdirSync(FUNCTIONS_DIR)
    .filter((f) => f.endsWith('.js'))
    .sort();
}

const allFiles = listFunctionFiles();
const coveredFiles = allFiles.filter((f) => !SKIP.has(f));

describe('netlify/functions smoke coverage', () => {
  test('every function file is either covered or explicitly (and minimally) skipped', () => {
    expect(allFiles.length).toBeGreaterThan(0);
    for (const f of SKIP) {
      expect(allFiles).toContain(f); // no stale skip entries for deleted files
    }
  });

  describe.each(coveredFiles)('%s', (file) => {
    const isPrivate = file.startsWith('_');
    let mod;
    let loadError = null;

    beforeAll(() => {
      jest.resetModules();
      try {
        mod = require(path.join(FUNCTIONS_DIR, file));
      } catch (e) {
        loadError = e;
      }
    });

    test('loads without throwing', () => {
      if (loadError) {
        throw loadError;
      }
      expect(mod).toBeTruthy();
    });

    if (!isPrivate) {
      test('exports a handler function', () => {
        if (loadError) throw loadError; // already reported above; skip redundant failure detail
        expect(typeof mod.handler).toBe('function');
      });
    }
  });
});

// ── Pass 2 (hardening): invoke every loadable handler once with a minimal
// event and assert it doesn't blow up synchronously or reject with a
// TypeError — the signature of a genuine coding bug (undefined.property,
// calling a non-function) as opposed to an expected validation error. ──
describe('netlify/functions handler smoke invocation', () => {
  const minimalV1Event = {
    httpMethod: 'GET',
    headers: {},
    queryStringParameters: {},
    body: null,
    path: '/',
  };

  describe.each(coveredFiles.filter((f) => !f.startsWith('_')))('%s', (file) => {
    test('handler(minimal event) does not throw/reject a TypeError', async () => {
      jest.resetModules();
      let mod;
      try {
        mod = require(path.join(FUNCTIONS_DIR, file));
      } catch (e) {
        // Load failure already reported by pass 1 — nothing new to assert here.
        return;
      }
      if (typeof mod.handler !== 'function') return; // reported by pass 1

      let result;
      let thrown = null;
      try {
        result = mod.handler(minimalV1Event, {});
        if (result && typeof result.then === 'function') {
          result = await result;
        }
      } catch (e) {
        thrown = e;
      }

      if (thrown instanceof TypeError) {
        // Genuine crasher on a bare minimal event — surfaced, not silently
        // swallowed, so it shows up in the smoke report rather than hiding.
        throw new Error(
          `${file}: handler threw TypeError on minimal GET event: ${thrown.message}`
        );
      }
      // Any other thrown error (validation, auth, etc.) is acceptable —
      // these functions are allowed to reject an under-specified request.
    });
  });
});
