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

// Pull the 624Wx724H "mainImage" gallery URLs for one color's product page.
// mediaCodes look like "4349_TrueRoyal-12-ST350TrueRoyalFormFront4_624Wx724H";
// accept Form or Flat naming. Only this variant's own media counts (the page
// also embeds a sibling color's lifestyle shot).
function extractFormImages(html, variantId) {
  const out = { front: null, back: null };
  const re = /"url":"([^"]+)"[^{}]*?"mediaCode":"([^"]+_624Wx724H)"/g;
  let m;
  while ((m = re.exec(html))) {
    const code = m[2];
    if (!code.startsWith(variantId + '-')) continue;
    let url = m[1].replace(/\\u003d/gi, '=').replace(/\\u0026/gi, '&').replace(/\\\//g, '/');
    if (url.startsWith('//')) url = 'https:' + url;
    if (/(form|flat)front/i.test(code)) out.front = out.front || url;
    else if (/(form|flat)back/i.test(code)) out.back = out.back || url;
  }
  return out;
}

// Scrape every color variant of one style. Returns { normColorCode: {front, back} }.
async function scrapeStyle(coveo, style, log = console.log) {
  const found = await findProductPath(coveo, style);
  if (!found) return null;
  const baseHtml = await fetchText('https://www.sanmar.com' + found.path);
  const variantIds = [...new Set(baseHtml.match(new RegExp(found.groupId + '_[A-Za-z0-9]+', 'g')) || [])].slice(0, MAX_COLORS_PER_STYLE);
  const byColor = {};
  for (const vid of variantIds) {
    await sleep(PAGE_DELAY_MS);
    try {
      const html = vid === found.path.split('/p/')[1] ? baseHtml : await fetchText('https://www.sanmar.com/p/' + vid);
      const imgs = extractFormImages(html, vid);
      if (imgs.front) byColor[norm(vid.slice(found.groupId.length + 1))] = imgs;
    } catch (e) { log('[sanmar-flat-images] variant ' + vid + ': ' + e.message); }
  }
  return byColor;
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
    const prods = await (await sb('products?inventory_source=eq.sanmar&is_active=eq.true&select=id,sku,color,image_flat_front_url&limit=20000')).json();
    const byStyle = {};
    for (const p of arr(prods)) {
      const st = String(p.sku || '').split('-')[0].trim().toUpperCase();
      if (st) (byStyle[st] = byStyle[st] || []).push(p);
    }
    const state = await (await sb('sanmar_flat_state?select=style,checked_at&limit=20000')).json();
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
        const byColor = await scrapeStyle(coveo, style);
        let matched = 0;
        const colorsFound = byColor ? Object.keys(byColor).length : 0;
        if (byColor) {
          for (const p of byStyle[style] || []) {
            // Our sku suffix ("TrueRoyal", "WHITE") and color name ("True Royal")
            // both normalize onto sanmar.com's variant color code.
            const codeFromSku = norm(String(p.sku || '').split('-').slice(1).join('-'));
            const imgs = byColor[codeFromSku] || byColor[norm(p.color)];
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
            note: byColor ? null : 'not found on sanmar.com',
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
exports._internal = { extractFormImages, scrapeStyle, coveoConfig, norm };
