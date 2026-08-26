#!/usr/bin/env node
/**
 * Renders the S&S ↔ adidas SKU conversion key (scripts/adidas-ss-sku-key.sql)
 * into a print-ready PDF for the decorator's packing station.
 *
 * The key exists because S&S ships adidas Team goods without re-tagging: the
 * paperwork carries the S&S style (AT101) and the garment carries adidas' own
 * article number (JX4452). Packers need to confirm the two are the same piece.
 *
 * Usage:
 *   psql "$SUPABASE_DB_URL" -Aqt -f scripts/adidas-ss-sku-key.sql > key.json
 *   node scripts/build-adidas-ss-key-pdf.js key.json out.pdf
 *
 * Renders via the Chromium that ships with Playwright's browser bundle; set
 * CHROME_BIN to override.
 */

const fs = require('fs');
const { execFileSync } = require('child_process');
const path = require('path');

const IN = process.argv[2] || 'key.json';
const OUT = path.resolve(process.argv[3] || 'adidas-ss-sku-key.pdf');
const CHROME = process.env.CHROME_BIN || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

const rows = JSON.parse(fs.readFileSync(IN, 'utf8'));
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Garment label: the S&S name minus the "(AT101)" suffix it already carries.
const garment = (r) => String(r.sn || '').replace(/\s*\(AT\d+\)\s*$/, '').replace(/^Adidas\s+/i, '');
const sizes = (r) => (Array.isArray(r.sz) ? r.sz.join(' · ') : '');
// Highest stock first — the article we actually hold is the one most likely on the tag.
const arts = (r) => (r.ar || []).slice().sort((a, b) => (b.q || 0) - (a.q || 0) || String(a.a).localeCompare(String(b.a)));

const matched = rows.filter((r) => (r.ar || []).length);
const unmatched = rows.filter((r) => !(r.ar || []).length);

// Reverse index — the lookup a packer actually performs: tag in hand, is this right?
const rev = [];
for (const r of rows) for (const a of arts(r)) rev.push({ article: a.a, adColour: a.c, adName: a.n, qty: a.q || 0, ss: r.ss, ssColour: r.sc, garment: garment(r) });
rev.sort((a, b) => a.article.localeCompare(b.article));

// An article that resolves to two different S&S styles cannot be answered from the
// tag alone — call those out instead of letting the table imply a single answer.
const byArticle = new Map();
for (const e of rev) {
  if (!byArticle.has(e.article)) byArticle.set(e.article, new Set());
  byArticle.get(e.article).add(e.ss.replace(/-[^-]*$/, ''));
}
const conflicting = new Set([...byArticle].filter(([, v]) => v.size > 1).map(([k]) => k));

// Families where several articles share one recorded colour: our catalog lost the
// distinction (three "Dark Green/White" Pregame tees), so the packer must eyeball it.
const dupColour = [];
for (const r of matched) {
  const seen = new Map();
  for (const a of arts(r)) {
    const k = String(a.c || '').toLowerCase().replace(/\s+/g, '');
    seen.set(k, (seen.get(k) || 0) + 1);
  }
  if ([...seen.values()].some((n) => n > 1)) dupColour.push(r);
}

const families = [...new Set(rows.map(garment))].sort();
const stamp = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

const chip = (q) => (q > 0 ? `<span class="stk">${q}</span>` : '');

const fwdRows = families.map((f) => {
  const rs = matched.filter((r) => garment(r) === f).sort((a, b) => a.ss.localeCompare(b.ss));
  if (!rs.length) return '';
  const style = rs[0].ss.replace(/-[^-]*$/, '');
  return `<tr class="grp"><td colspan="4"><span class="gstyle">${esc(style)}</span>${esc(f)}</td></tr>` + rs.map((r) => `
    <tr>
      <td class="mono nowrap">${esc(r.ss)}</td>
      <td>${esc(r.sc)}</td>
      <td>${arts(r).map((a) => `<span class="art">${esc(a.a)}</span>${chip(a.q)}`).join(' ')}</td>
      <td class="sz">${esc(sizes(r))}</td>
    </tr>`).join('');
}).join('');

const revRows = rev.map((e) => `
  <tr${conflicting.has(e.article) ? ' class="warn"' : ''}>
    <td class="mono nowrap"><b>${esc(e.article)}</b>${conflicting.has(e.article) ? ' <span class="flag">check</span>' : ''}</td>
    <td>${esc(e.adColour)}</td>
    <td class="mono nowrap">${esc(e.ss)}</td>
    <td>${esc(e.garment)}</td>
    <td class="num">${e.qty > 0 ? e.qty : ''}</td>
  </tr>`).join('');

const openRows = unmatched.sort((a, b) => a.ss.localeCompare(b.ss)).map((r) => `
  <tr><td class="mono nowrap">${esc(r.ss)}</td><td>${esc(garment(r))}</td><td>${esc(r.sc)}</td></tr>`).join('');

const dupRows = dupColour.map((r) => `
  <tr><td class="mono nowrap">${esc(r.ss)}</td><td>${esc(garment(r))}</td><td>${esc(r.sc)}</td>
      <td>${arts(r).map((a) => `<span class="art">${esc(a.a)}</span>`).join(' ')}</td></tr>`).join('');

const html = `<!doctype html><html><head><meta charset="utf-8"><title>adidas / S&amp;S SKU Conversion Key</title>
<style>
  @page { size: letter; margin: 14mm 12mm 16mm; }
  * { box-sizing: border-box; }
  body { font-family: "Liberation Sans", Arial, Helvetica, sans-serif; color: #16202b; margin: 0; font-size: 9pt; line-height: 1.4; }
  .mono, .art, .stk { font-family: "DejaVu Sans Mono", "Liberation Mono", monospace; }

  .cover { border-top: 5px solid #1b3a5c; padding-top: 14px; }
  h1 { font-size: 21pt; margin: 0 0 2px; letter-spacing: -.3px; }
  .sub { font-size: 10.5pt; color: #4a5b6e; margin-bottom: 2px; }
  .meta { font-size: 8pt; color: #7b8794; margin-bottom: 16px; }

  .lead { background: #f4f7fa; border-left: 3px solid #1b3a5c; padding: 10px 13px; margin: 0 0 12px; }
  .lead h2 { font-size: 10pt; margin: 0 0 5px; text-transform: uppercase; letter-spacing: .6px; color: #1b3a5c; }
  .lead p { margin: 0 0 6px; }
  .lead p:last-child { margin-bottom: 0; }
  .eg { background: #fff; border: 1px solid #dde4ec; padding: 7px 10px; margin-top: 8px; font-size: 8.5pt; }
  .eg b { color: #1b3a5c; }

  h2.sec { font-size: 12pt; margin: 0 0 3px; padding-bottom: 4px; border-bottom: 2px solid #1b3a5c; }
  .hint { font-size: 8pt; color: #5c6b7d; margin: 0 0 7px; }

  table { width: 100%; border-collapse: collapse; }
  th { background: #1b3a5c; color: #fff; font-size: 7.5pt; text-transform: uppercase; letter-spacing: .5px;
       text-align: left; padding: 5px 6px; }
  td { padding: 4px 6px; border-bottom: .5px solid #e3e9ef; vertical-align: top; }
  tr.grp td { background: #eef2f7; font-weight: bold; font-size: 8.5pt; padding: 5px 6px; border-bottom: 1px solid #c9d5e2; }
  .gstyle { font-family: "DejaVu Sans Mono", monospace; color: #1b3a5c; margin-right: 8px; }
  .art { background: #eaf0f7; border: .5px solid #b9cbdd; padding: .5px 4px; font-size: 8.5pt; font-weight: bold; white-space: nowrap; }
  .stk { font-size: 6.5pt; color: #1d6b42; margin-left: 2px; vertical-align: super; }
  .sz { font-size: 7pt; color: #74818f; }
  .num { text-align: right; color: #1d6b42; font-weight: bold; }
  .nowrap { white-space: nowrap; }
  tr.warn td { background: #fff8e8; }
  .flag { background: #b45309; color: #fff; font-size: 6.5pt; padding: .5px 3px; text-transform: uppercase; letter-spacing: .4px; }

  thead { display: table-header-group; }
  tr { break-inside: avoid; }
  .page { break-before: page; }
  .note { font-size: 8pt; color: #5c6b7d; background: #fbfcfd; border: 1px solid #e3e9ef; padding: 8px 11px; margin-top: 10px; }
</style></head><body>

<div class="cover">
  <h1>adidas &harr; S&amp;S SKU Conversion Key</h1>
  <div class="sub">National Sports Apparel &rarr; Silverscreen Decoration &amp; Fulfillment</div>
  <div class="meta">Generated ${esc(stamp)} &nbsp;·&nbsp; ${matched.length} matched style/colours &nbsp;·&nbsp; ${rev.length} adidas article numbers</div>
</div>

<div class="lead">
  <h2>Why the numbers don't match</h2>
  <p>We buy adidas Team goods through <b>S&amp;S Activewear</b>, who list them under their own style
     numbers (<span class="mono">AT101</span>). S&amp;S does not re-tag the garments, so what reaches you
     still carries <b>adidas' own article number</b> (<span class="mono">JX4452</span>). Both numbers
     describe the same piece &mdash; one per colour.</p>
  <p>If the tag doesn't match the packing slip, look the number up here. If it appears on this
     key, the garment is correct and you are clear to proceed.</p>
  <div class="eg"><b>Example &mdash; Pregame Tee, Black:</b> ordered from S&amp;S as
     <span class="mono">AT101-50</span> &nbsp;=&nbsp; arrives tagged <span class="mono">JX4452</span>.
     Same shirt. The long sleeve in black is <span class="mono">AT104-50</span> = <span class="mono">JX4476</span>.</div>
</div>

<h2 class="sec">1 &nbsp;Tag lookup &mdash; you have the garment</h2>
<p class="hint">Find the article number printed on the garment tag to see which ordered style it fills.
   The right-hand column is the quantity we hold in our warehouse, which is a good sign the piece is current.${
     conflicting.size ? ' Rows marked <span class="flag">check</span> match more than one style &mdash; confirm with us before packing.' : ''}</p>
<table>
  <thead><tr><th style="width:16%">adidas article (on tag)</th><th style="width:22%">Colour</th>
    <th style="width:16%">= S&amp;S SKU (on slip)</th><th style="width:36%">Garment</th><th style="width:10%">In house</th></tr></thead>
  <tbody>${revRows}</tbody>
</table>

<div class="page"></div>
<h2 class="sec">2 &nbsp;Order lookup &mdash; you have the paperwork</h2>
<p class="hint">Find the S&amp;S style from the order or packing slip to see every adidas article number that
   is a valid fill. More than one is normal &mdash; adidas issues a new article each season for the same
   garment and colour, so <b>any</b> of the numbers listed is correct.</p>
<table>
  <thead><tr><th style="width:15%">S&amp;S SKU</th><th style="width:24%">Colour</th>
    <th style="width:39%">Valid adidas article numbers</th><th style="width:22%">Sizes</th></tr></thead>
  <tbody>${fwdRows}</tbody>
</table>

${dupRows ? `<div class="page"></div>
<h2 class="sec">3 &nbsp;Confirm by eye before packing</h2>
<p class="hint">For these colours our catalog lists several article numbers under one colour name
   (adidas splits shades we record identically &mdash; e.g. kelly, team green and dark green all read
   "Dark Green"). Any of the numbers below is the right <i>garment</i>, but please confirm the
   <i>shade</i> against the approved sample before packing.</p>
<table>
  <thead><tr><th style="width:15%">S&amp;S SKU</th><th style="width:30%">Garment</th>
    <th style="width:20%">Colour ordered</th><th style="width:35%">Articles sharing this colour</th></tr></thead>
  <tbody>${dupRows}</tbody>
</table>` : ''}

${openRows ? `<h2 class="sec" style="margin-top:16px">${dupRows ? '4' : '3'} &nbsp;Not yet cross-referenced</h2>
<p class="hint">We have not yet matched an adidas article to these S&amp;S colours &mdash; we have not bought
   them recently, so no tagged stock has come through. If one of these arrives and the tag doesn't match,
   flag it to us and we will add it to the next revision.</p>
<table>
  <thead><tr><th style="width:18%">S&amp;S SKU</th><th style="width:46%">Garment</th><th style="width:36%">Colour</th></tr></thead>
  <tbody>${openRows}</tbody>
</table>` : ''}

<div class="note"><b>How this was built.</b> Cross-referenced from National Sports Apparel's product
  catalog: the adidas Team range synced from the S&amp;S Activewear API against the adidas article numbers
  on our own in-house stock, matched by garment and colour. Questions or a number that isn't listed &mdash;
  contact National Sports Apparel and we will confirm and reissue.</div>

</body></html>`;

const tmp = path.join(require('os').tmpdir(), `adidas-key-${process.pid}.html`);
fs.writeFileSync(tmp, html);
execFileSync(CHROME, ['--headless', '--disable-gpu', '--no-sandbox', '--no-pdf-header-footer',
  `--print-to-pdf=${OUT}`, 'file://' + tmp], { stdio: 'inherit' });
fs.unlinkSync(tmp);
console.log(`${OUT}  (${matched.length} matched, ${rev.length} article rows, ${unmatched.length} open, ${conflicting.size} conflicting)`);
