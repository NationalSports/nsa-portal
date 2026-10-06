// Background function (15-min limit): swaps SanMar model photography for the
// product-only "form" photos (front + back, no model) shown on sanmar.com.
//
// SanMar's SOAP feed (used by sanmar-brands-sync / sanmar-nike-sync) returns a
// single image per color — the model shot — and the form/flat variants aren't
// URL-guessable on the CDN. sanmar.com itself renders them, so this walks the
// public site: Coveo product search (storefront token scraped from the site's
// own page config) → each color's product page → the server-rendered
// galleryImages JSON → the 624Wx724H "FormFront"/"FormBack" media URLs on
// cdnp.sanmar.com.
//
// Found URLs land in products.image_flat_front_url / image_flat_back_url; the
// trg_products_prefer_flat_images trigger (migration 075) repoints
// image_front_url/image_back_url at them on every write, so the nightly model
// -shot upserts from the catalog syncs can't clobber them back.
//
// Converges over runs: per-style progress is tracked in sanmar_flat_state and
// styles are rechecked after RECHECK_DAYS. Force specific styles with
//   curl -X POST '.../sanmar-flat-images-background?styles=ST350,ST485'
//
// Env: REACT_APP_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

const BUDGET_MS = 12 * 60 * 1000;   // leave headroom inside the 15-min limit
const PAGE_DELAY_MS = 300;          // politeness delay between sanmar.com fetches
const RECHECK_DAYS = 60;            // form photos rarely change
const MAX_COLORS_PER_STYLE = 60;

const arr = (v) => (Array.isArray(v) ? v : v != null ? [v] : []);
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
// sanmar.com abbreviates variant color codes by dropping letters from the full
// color name ("HeatheredDeepRoyal" → "HthrdDpRyl", "OliveDrabGreen" →
// "OlvDrabGn"), so an in-order subsequence test recovers the pairing that exact
// comparison misses. Require the code to be at least a third of the name so a
// tiny code can't match everything.
const isAbbrevOf = (code, name) => {
  if (!code || !name || code.length > name.length || code.length * 3 < name.length) return false;
  let i = 0;
  for (const ch of name) { if (ch === code[i]) i++; if (i === code.length) return true; }
  return false;
};
// Character-bigram Dice coefficient (0..1) — a spelling-similarity score that
// tolerates SanMar's occasional typos/variants ("Blust Frost" vs our "Blush
// Frost") without the false matches a loose substring test would cause.
const dice = (a, b) => {
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const bg = (s) => { const m = new Map(); for (let i = 0; i < s.length - 1; i++) { const g = s.slice(i, i + 2); m.set(g, (m.get(g) || 0) + 1); } return m; };
  const A = bg(a), B = bg(b); let inter = 0;
  for (const [g, n] of A) if (B.has(g)) inter += Math.min(n, B.get(g));
  return (2 * inter) / ((a.length - 1) + (b.length - 1));
};
// Pick the SanMar variant color code that best matches one of our product's
// color keys (its sku suffix + its color name, both normalized). Exact and
// abbreviation matches win outright; otherwise the closest spelling, but only
// when it clears a high bar AND clearly beats the runner-up — a wrong-color
// photo is worse than falling back to the model shot, so ambiguity → no match.
const bestColorMatch = (targets, candidates) => {
  const score = (cand) => {
    let best = 0;
    for (const t of targets) {
      if (!t) continue;
      if (t === cand) return 1;
      if (isAbbrevOf(cand, t) || isAbbrevOf(t, cand)) best = Math.max(best, 0.9);
      else best = Math.max(best, dice(t, cand));
    }
    return best;
  };
  let top = null, topScore = 0, second = 0;
  for (const c of candidates) {
    const s = score(c);
    if (s > topScore) { second = topScore; topScore = s; top = c; }
    else if (s > second) { second = s; }
  }
  if (topScore >= 0.999 || (topScore >= 0.74 && topScore - second >= 0.08)) return top;
  return null;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

async function fetchText(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html,*/*' } });
  if (!r.ok) throw new Error(url + ' → ' + r.status);
  return r.text();
}

// The public Coveo storefront token + org id live in sanmar.com's page config —
// scraping them each run self-heals when the site rotates the token.
async function coveoConfig() {
  const html = await fetchText('https://www.sanmar.com/search?text=tee');
  const token = (html.match(/coveoAccessToken\s*=\s*'([^']+)'/) || [])[1];
  const orgId = (html.match(/coveoOrganizationId\s*=\s*'([^']+)'/) || [])[1];
  if (!token || !orgId) throw new Error('Coveo config not found in sanmar.com page — site layout changed?');
  return { token, orgId };
}

// Style number → the base product page path (e.g. ST350 → /p/4349_OlvDrabGn).
async function findProductPath({ token, orgId }, style) {
  const res = await fetch(`https://${orgId}.org.coveo.com/rest/organizations/${orgId}/commerce/v2/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({
      query: style, trackingId: 'sanmar', language: 'en', country: 'US', currency: 'USD',
      clientId: 'nsa-flat-image-sync',
      context: { view: { url: 'https://www.sanmar.com/search?text=' + encodeURIComponent(style) }, capture: false, cart: [], source: ['@commerce'] },
      page: 0, perPage: 10,
    }),
  });
  if (!res.ok) throw new Error('coveo ' + res.status);
  const j = await res.json();
  const hit = arr(j.products).find((p) => norm((p.additionalFields || {}).ec_style_number) === norm(style));
  const f = hit && hit.additionalFields;
  if (!f || !f.clickableuri) return null;
  return { path: f.clickableuri, groupId: String(f.ec_item_group_id || String(f.clickableuri).split('/p/')[1].split('_')[0]) };
}

// Pull the garment-only 624Wx724H gallery URLs for a color from its product page.
// SanMar names its shots two ways: apparel gets a model shot ("...ModelFront4")
// plus a garment-only "...FormFront"/"...FlatFront"; accessories shot only as a
// flat lay (beanies, bags) get a plain "...front" with no qualifier. We take the
// Form/Flat when present; otherwise the plain shot ONLY when the color has no
// model image at all (so a plain name can never be a disguised model shot).
//
// A page embeds media for several colors (its own + a sibling lifestyle shot),
// and the media's color token can differ from the URL's variant id
// ("4947_CharcoalHt" in the URL vs "4947_CharcoalHthr" in the media code), so we
// group media by color token and select the token that best matches `targets`.
function extractGarmentImages(html, groupId, targets) {
  const re = /"url":"([^"]+)"[^{}]*?"mediaCode":"([^"]+_624Wx724H)"/g;
  const byToken = {};
  const codeRe = new RegExp('^' + groupId + '_([A-Za-z0-9]+)-\\d+-(.+?)_624Wx724H$');
  let m;
  while ((m = re.exec(html))) {
    const cm = m[2].match(codeRe);
    if (!cm) continue;
    const token = norm(cm[1]); const tag = cm[2];
    const side = /back/i.test(tag) ? 'back' : /front/i.test(tag) ? 'front' : null;
    if (!side) continue; // skip side / lifestyle / detail shots
    let url = m[1].replace(/\\u003d/gi, '=').replace(/\\u0026/gi, '&').replace(/\\\//g, '/');
    if (url.startsWith('//')) url = 'https:' + url;
    (byToken[token] = byToken[token] || []).push({ side, url, kind: /form|flat/i.test(tag) ? 'flat' : /model/i.test(tag) ? 'model' : 'plain' });
  }
  const token = bestColorMatch(targets, Object.keys(byToken));
  const entries = (token && byToken[token]) || [];
  const pick = (side) => {
    const s = entries.filter((e) => e.side === side);
    const flat = s.find((e) => e.kind === 'flat');
    if (flat) return flat.url;
    if (!s.some((e) => e.kind === 'model')) { const plain = s.find((e) => e.kind === 'plain'); if (plain) return plain.url; }
    return null;
  };
  return { front: pick('front'), back: pick('back') };
}

// Scrape one style and map each of OUR products (passed in, [{id,sku,color}]) to
// its garment-only front/back. Returns { [productId]: {front, back} } for the
// products that got a flat. Matching each product to a sanmar variant up front
// (exact → abbreviation → closest spelling) means we fetch only the color pages
// we carry and never mis-assign a color.
async function scrapeStyle(coveo, style, products = [], log = console.log) {
  const found = await findProductPath(coveo, style);
  if (!found) return null; // style not on sanmar.com
  const baseHtml = await fetchText('https://www.sanmar.com' + found.path);
  // Take fetch ids from the color swatch page-links ("/p/4947_CharcoalHt") only —
  // a raw groupId_X scan also picks up media-code color tokens ("4947_CharcoalHthr")
  // that 404 as page URLs. The media token is matched separately in the extractor.
  const variantIds = [...new Set((baseHtml.match(new RegExp('/p/' + found.groupId + '_[A-Za-z0-9]+', 'g')) || []).map((s) => s.slice(3)))].slice(0, MAX_COLORS_PER_STYLE);
  const codeOf = (vid) => norm(vid.slice(found.groupId.length + 1));
  const byCode = {}; variantIds.forEach((v) => { byCode[codeOf(v)] = v; });
  const codes = Object.keys(byCode);
  // product → { targets, vid } (only colors we carry get fetched)
  const pick = {}; const htmlByVid = {};
  for (const p of products) {
    const targets = [norm(String(p.sku || '').split('-').slice(1).join('-')), norm(p.color)].filter(Boolean);
    const code = bestColorMatch(targets, codes);
    if (code) { pick[p.id] = { targets, vid: byCode[code] }; htmlByVid[byCode[code]] = null; }
  }
  for (const vid of Object.keys(htmlByVid)) {
    await sleep(PAGE_DELAY_MS);
    try {
      htmlByVid[vid] = vid === found.path.split('/p/')[1] ? baseHtml : await fetchText('https://www.sanmar.com/p/' + vid);
    } catch (e) { log('[sanmar-flat-images] variant ' + vid + ': ' + e.message); }
  }
  const out = {};
  for (const p of products) {
    const sel = pick[p.id]; const html = sel && htmlByVid[sel.vid];
    if (!html) continue;
    const imgs = extractGarmentImages(html, found.groupId, sel.targets);
    if (imgs.front) out[p.id] = imgs;
  }
  return out;
}

exports.handler = async (event) => {
  const sbUrl = (process.env.REACT_APP_SUPABASE_URL || '').replace(/\/+$/, '');
  const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!sbUrl || !sbKey) return { statusCode: 500, body: 'Not configured' };
  const sb = (path, init) => fetch(sbUrl + '/rest/v1/' + path, {
    ...init,
    headers: { 'Content-Type': 'application/json', apikey: sbKey, Authorization: 'Bearer ' + sbKey, ...(init && init.headers) },
  });

  const started = Date.now();
  const forced = String((event && event.queryStringParameters && event.queryStringParameters.styles) || '')
    .split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);

  try {
    const coveo = await coveoConfig();

    // Candidate styles: every active SanMar product, grouped by style (sku prefix).
    // PostgREST caps a single response at ~1000 rows regardless of `limit`, so
    // page with Range headers or most of the catalog is silently invisible.
    const pageAll = async (path) => {
      const out = [];
      for (let from = 0; ; from += 1000) {
        const res = await sb(path, { headers: { Range: from + '-' + (from + 999), 'Range-Unit': 'items' } });
        const page = arr(await res.json().catch(() => []));
        out.push(...page);
        if (page.length < 1000) return out;
      }
    };
    const prods = await pageAll('products?inventory_source=eq.sanmar&is_active=eq.true&select=id,sku,color,image_flat_front_url&order=id');
    const byStyle = {};
    for (const p of arr(prods)) {
      const st = String(p.sku || '').split('-')[0].trim().toUpperCase();
      if (st) (byStyle[st] = byStyle[st] || []).push(p);
    }
    const state = await pageAll('sanmar_flat_state?select=style,checked_at&order=style');
    const freshCutoff = Date.now() - RECHECK_DAYS * 24 * 3600e3;
    const fresh = new Set(arr(state).filter((r) => new Date(r.checked_at).getTime() > freshCutoff).map((r) => r.style));
    // Styles still missing a flat image go first so the budget always makes
    // forward progress; fully-covered styles only recheck after RECHECK_DAYS.
    const styles = forced.length ? forced : Object.keys(byStyle)
      .filter((s) => !fresh.has(s))
      .sort((a, b) => {
        const miss = (s) => (byStyle[s].some((p) => !p.image_flat_front_url) ? 0 : 1);
        return miss(a) - miss(b);
      });

    let stylesDone = 0, updated = 0;
    const errors = [];
    for (const style of styles) {
      if (Date.now() - started > BUDGET_MS) break;
      try {
        const imgsByProduct = await scrapeStyle(coveo, style, byStyle[style] || []);
        let matched = 0;
        const colorsFound = imgsByProduct ? Object.keys(imgsByProduct).length : 0;
        if (imgsByProduct) {
          for (const p of byStyle[style] || []) {
            const imgs = imgsByProduct[p.id];
            if (!imgs || !imgs.front) continue;
            const body = { image_flat_front_url: imgs.front };
            if (imgs.back) body.image_flat_back_url = imgs.back;
            const ur = await sb('products?id=eq.' + encodeURIComponent(p.id), {
              method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(body),
            });
            if (ur.ok) matched++; else errors.push(p.id + ': patch ' + ur.status);
          }
        }
        updated += matched;
        stylesDone++;
        await sb('sanmar_flat_state?on_conflict=style', {
          method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
          body: JSON.stringify([{
            style, checked_at: new Date().toISOString(), colors_found: colorsFound, products_updated: matched,
            note: imgsByProduct ? null : 'not found on sanmar.com',
          }]),
        });
      } catch (e) {
        errors.push(style + ': ' + e.message);
        if (errors.length > 60) break;
      }
    }

    const summary = { styles_considered: styles.length, styles_done: stylesDone, products_updated: updated, errors: errors.slice(0, 10) };
    console.log('[sanmar-flat-images] done:', JSON.stringify(summary));
    return { statusCode: 200, body: JSON.stringify(summary) };
  } catch (e) {
    console.error('[sanmar-flat-images]', e);
    return { statusCode: 500, body: e.message };
  }
};

// Exported for the one-off local backfill / tests.
exports._internal = { extractGarmentImages, scrapeStyle, coveoConfig, norm, bestColorMatch, dice, isAbbrevOf };
