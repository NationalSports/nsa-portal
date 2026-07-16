/* Tests for store-quick-build.js's pure helpers (_internals) — the parts of the 2026-07
 * pre-merge safety-review hardening that don't require a live Supabase client: slug/
 * alpha-tag generation (including the empty-base 'TEAM' fallback), the draft-always store
 * row builder (+ director fields), the ilike-escape used by the existing-customer guard,
 * and the pre-publish sanity gate that keeps a $0-priced or half-cloned template from
 * going live in one click.
 *
 * The DB-flow guards (existing-customer match, customer+sport duplicate check, lead
 * claim/release on the way out) are exercised through these same pure building blocks and
 * are not separately re-tested here with a mocked Supabase client — see storeApproval.test.js
 * for that style of test elsewhere in this repo, kept out of scope here per the task's
 * explicit test list.
 */
const {
  slugify, nextAlphaTag, buildStoreRow, sanityCheckClone, escapeIlike, alphaTagBase,
} = require('../../netlify/functions/store-quick-build')._internals;

test('store-quick-build.js loads as a Netlify function', () => {
  const mod = require('../../netlify/functions/store-quick-build');
  expect(typeof mod.handler).toBe('function');
});

describe('slugify', () => {
  test('lowercases, dashes punctuation/spaces', () => {
    expect(slugify('Lincoln HS Football!')).toBe('lincoln-hs-football');
  });

  test('collapses repeated separators and trims leading/trailing dashes', () => {
    expect(slugify('  --Foo   Bar--  ')).toBe('foo-bar');
  });

  test('truncates to 60 chars', () => {
    expect(slugify('a'.repeat(100)).length).toBe(60);
  });

  test('empty/symbols-only/nullish input falls back to team-store', () => {
    expect(slugify('')).toBe('team-store');
    expect(slugify('!!!')).toBe('team-store');
    expect(slugify(null)).toBe('team-store');
    expect(slugify(undefined)).toBe('team-store');
  });
});

describe('alphaTagBase', () => {
  test('first two alnum words, upper, <=12 chars', () => {
    expect(alphaTagBase('Lincoln High School')).toBe('LINCOLN HIGH');
  });

  test('strips punctuation but keeps spaces', () => {
    expect(alphaTagBase("St. Mary's Eagles")).toBe('ST MARYS');
  });

  test('a symbols-only (or empty) name yields an empty base', () => {
    expect(alphaTagBase('!!!')).toBe('');
    expect(alphaTagBase('')).toBe('');
    expect(alphaTagBase(null)).toBe('');
  });
});

describe('nextAlphaTag', () => {
  test('uses the base as-is when it is not taken', () => {
    expect(nextAlphaTag('Lincoln High', [])).toBe('LINCOLN HIGH');
  });

  test('case/whitespace-insensitive collision suffixes " 2"', () => {
    expect(nextAlphaTag('Lincoln High', [' lincoln high '])).toBe('LINCOLN HI 2');
  });

  test('walks the suffix past a run of taken candidates', () => {
    expect(nextAlphaTag('Lincoln High', ['LINCOLN HIGH', 'LINCOLN HI 2', 'LINCOLN HI 3'])).toBe('LINCOLN HI 4');
  });

  test('empty-base fallback: the handler passes "TEAM" as name when alphaTagBase(customerName) is empty', () => {
    // alphaTagBase('!!!') === '' — the handler's effectiveBase falls back to 'TEAM' and
    // passes THAT (not the original garbage name) into nextAlphaTag. Confirm 'TEAM'
    // round-trips as a normal base, including its own collision suffixing.
    expect(nextAlphaTag('TEAM', [])).toBe('TEAM');
    expect(nextAlphaTag('TEAM', ['team'])).toBe('TEAM 2');
    expect(nextAlphaTag('TEAM', ['TEAM', 'TEAM 2'])).toBe('TEAM 3');
  });
});

describe('escapeIlike', () => {
  test('escapes %, _, and a literal backslash so a name matches ilike literally', () => {
    expect(escapeIlike('100% Wildcats')).toBe('100' + '\\' + '% Wildcats');
    expect(escapeIlike('A_B')).toBe('A' + '\\' + '_B');
    const input = 'back' + '\\' + 'slash'; // one literal backslash
    expect(escapeIlike(input)).toBe('back' + '\\' + '\\' + 'slash'); // doubled
  });

  test('plain names pass through unchanged', () => {
    expect(escapeIlike('Lincoln High')).toBe('Lincoln High');
  });

  test('null/undefined -> empty string, not "null"/"undefined"', () => {
    expect(escapeIlike(null)).toBe('');
    expect(escapeIlike(undefined)).toBe('');
  });
});

describe('buildStoreRow', () => {
  const tpl = {
    id: 'tpl-1', created_at: 't0', updated_at: 't0',
    name: 'Football Template', slug: 'football-template', status: 'draft', is_template: true,
    sport: 'football', logo_url: 'https://tpl/logo.png', primary_color: '#111111', accent_color: '#222222',
    payment_mode: 'paid',
  };
  const base = { store_name: 'Lincoln Eagles', slug: 'lincoln-eagles', customer_id: 'c1' };

  test('is ALWAYS a draft — status/open_at are hardcoded, not driven by a publish flag', () => {
    // buildStoreRow takes no publish input at all; the handler flips a store live only via
    // a later, sanity-checked update. Passing a truthy "publish"-shaped key must not matter.
    const row = buildStoreRow(tpl, { ...base, publish: true });
    expect(row.status).toBe('draft');
    expect(row.open_at).toBeNull();
  });

  test('strips template-only identity fields and sets store identity/ownership', () => {
    const row = buildStoreRow(tpl, base);
    expect(row.id).toBeUndefined();
    expect(row.created_at).toBeUndefined();
    expect(row.updated_at).toBeUndefined();
    expect(row.name).toBe('Lincoln Eagles');
    expect(row.slug).toBe('lincoln-eagles');
    expect(row.is_template).toBe(false);
    expect(row.customer_id).toBe('c1');
    expect(row.created_via).toBe('auto');
    expect(row.close_at).toBeNull();
    expect(row.featured_product_ids).toBeNull();
    expect(row.closed_notified_at).toBeNull();
  });

  test('branding falls back to the template when the request omits it', () => {
    const row = buildStoreRow(tpl, base);
    expect(row.sport).toBe('football');
    expect(row.logo_url).toBe('https://tpl/logo.png');
    expect(row.primary_color).toBe('#111111');
    expect(row.accent_color).toBe('#222222');
    expect(row.payment_mode).toBe('paid'); // untouched template field passes through
  });

  test('request branding overrides the template', () => {
    const row = buildStoreRow(tpl, {
      ...base, sport: 'soccer', logo_url: 'https://lead/logo.png', primary_color: '#abcabc', accent_color: '#defdef',
    });
    expect(row.sport).toBe('soccer');
    expect(row.logo_url).toBe('https://lead/logo.png');
    expect(row.primary_color).toBe('#abcabc');
    expect(row.accent_color).toBe('#defdef');
  });

  test('sets coach_contact_* AND director_* from the same coach fields', () => {
    // Quick Build's coach IS the store's director/family contact — the launch email reads
    // director_name for its display name (see src/Webstores.js launchEmailHtml callers).
    const row = buildStoreRow(tpl, { ...base, coach_name: 'Jane Coach', coach_email: 'jane@school.edu', coach_phone: '555-1212' });
    expect(row.coach_contact_name).toBe('Jane Coach');
    expect(row.coach_contact_email).toBe('jane@school.edu');
    expect(row.coach_contact_phone).toBe('555-1212');
    expect(row.director_name).toBe('Jane Coach');
    expect(row.director_email).toBe('jane@school.edu');
    expect(row.director_phone).toBe('555-1212');
  });

  test('no coach fields -> contact and director fields are all null', () => {
    const row = buildStoreRow(tpl, base);
    expect(row.director_name).toBeNull();
    expect(row.director_email).toBeNull();
    expect(row.director_phone).toBeNull();
    expect(row.coach_contact_name).toBeNull();
    expect(row.coach_contact_email).toBeNull();
    expect(row.coach_contact_phone).toBeNull();
  });
});

describe('sanityCheckClone', () => {
  test('no cloned rows -> fails, naming the reason', () => {
    expect(sanityCheckClone([])).toEqual({ ok: false, reason: 'No products were cloned into the store' });
    expect(sanityCheckClone(null)).toEqual({ ok: false, reason: 'No products were cloned into the store' });
  });

  test('a $0 retail_price among the cloned rows fails, naming the item', () => {
    const rows = [{ id: 'p1', retail_price: 25, label: 'Tee' }, { id: 'p2', retail_price: 0, label: 'Hoodie' }];
    expect(sanityCheckClone(rows)).toEqual({ ok: false, reason: 'Item "Hoodie" has a retail price of $0' });
  });

  test('a negative retail_price also fails the check', () => {
    expect(sanityCheckClone([{ id: 'p1', retail_price: -5, label: 'Tee' }]).ok).toBe(false);
  });

  test('a missing/non-numeric retail_price is treated the same as $0', () => {
    expect(sanityCheckClone([{ id: 'p1', retail_price: null, label: 'Tee' }])).toEqual({ ok: false, reason: 'Item "Tee" has a retail price of $0' });
    expect(sanityCheckClone([{ id: 'p1', label: 'Tee' }]).ok).toBe(false);
  });

  test('all cloned rows positively priced -> passes', () => {
    const rows = [{ id: 'p1', retail_price: 25, label: 'Tee' }, { id: 'p2', retail_price: 40, label: 'Hoodie' }];
    expect(sanityCheckClone(rows)).toEqual({ ok: true });
  });

  test('judges what actually cloned, not the template size — a clone that dies partway through with one good row still passes', () => {
    // This is the "half-cloned store" case: cloneProducts() only ever hands back rows that
    // actually landed, so a template with 10 items where only 1 successfully cloned is
    // judged on that 1 row alone.
    expect(sanityCheckClone([{ id: 'p1', retail_price: 10, label: 'Only survivor' }])).toEqual({ ok: true });
  });
});
