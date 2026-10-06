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
// ACTIVE articles only. An article is superseded when a DIFFERENT article for the
// same style+colour is still being shipped by the vendor — that is what makes the
// old one dead, not its age. So: keep every article the vendor still stocks, and
// where a colour has none, keep its best-known number rather than leaving the
// packer holding a real garment with no entry (JW6626 youth crew and KG1515 puffer
// are current-generation numbers that merely happen to be out of stock today).
const rank = (a, b) => (b.cur ? 1 : 0) - (a.cur ? 1 : 0) || (b.vs || 0) - (a.vs || 0)
  || (b.q || 0) - (a.q || 0) || String(a.a).localeCompare(String(b.a));
const arts = (r) => {
  const all = (r.ar || []).slice().sort(rank);
  const live = all.filter((a) => a.cur);
  return live.length ? live : all.slice(0, 1);
};
// True when a colour has no article in stock anywhere — the number we give is the
// right one, but nothing is sitting on a shelf, so it is worth saying so.
const outOfStock = (r) => (r.ar || []).length > 0 && !(r.ar || []).some((a) => a.cur);

const matched = rows.filter((r) => (r.ar || []).length);
const unmatched = rows.filter((r) => !(r.ar || []).length);

// Reverse index — the lookup a packer actually performs: tag in hand, is this right?
const rev = [];
for (const r of rows) for (const a of arts(r)) rev.push({ article: a.a, adColour: a.c, adName: a.n, qty: a.q || 0, cur: !!a.cur, ss: r.ss, ssColour: r.sc, garment: garment(r) });
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

// Sizes ride on the garment header, not on every colour: the size run is a property
// of the style, identical across its colours (AT302 is the lone exception, which
// keeps its own note). Repeating it per row cost a whole column for no information.
const fwdRows = families.map((f) => {
  const rs = matched.filter((r) => garment(r) === f).sort((a, b) => a.ss.localeCompare(b.ss));
  if (!rs.length) return '';
  const style = rs[0].ss.replace(/-[^-]*$/, '');
  // The size run belongs to the style, not the colour — identical across a style's
  // colours everywhere but AT302 — so it sits on the header instead of repeating.
  const runs = [...new Set(rs.map(sizes))];
  const common = runs.length === 1 ? runs[0] : '';
  return `<div class="blk">
    <div class="blkh"><span class="gstyle">${esc(style)}</span>${esc(f)}${
      common ? `<span class="hdrsz">${esc(common)}</span>` : ''}</div>` + rs.map((r) => `
    <div class="krow">
      <span class="ksku mono">${esc(r.ss)}</span>
      <span class="kcol">${esc(r.sc)}${common ? '' : `<span class="hdrsz">${esc(sizes(r))}</span>`}</span>
      <span class="kart">${arts(r).map((a) => `<span class="art">${esc(a.a)}</span>`).join(' ')}${
        outOfStock(r) ? ' <span class="oos">none in stock</span>' : ''}</span>
    </div>`).join('') + '</div>';
}).join('');

// The tag index answers one question — which SKU is this number? — so it is a list,
// not a table: the colour and garment it would otherwise repeat on every line are
// already on the row it points at.
const revIndex = rev.map((e) => `<div class="ix"><span class="mono">${esc(e.article)}</span>`
  + `<span class="ixto">${esc(e.ss)}</span>${conflicting.has(e.article) ? '<span class="flag">check</span>' : ''}</div>`).join('');

const openRows = unmatched.sort((a, b) => a.ss.localeCompare(b.ss)).map((r) => `
  <tr><td class="mono nowrap">${esc(r.ss)}</td><td>${esc(garment(r))}</td><td>${esc(r.sc)}</td></tr>`).join('');

const dupRows = dupColour.map((r) => `
  <tr><td class="mono nowrap">${esc(r.ss)}</td><td>${esc(garment(r))}</td><td>${esc(r.sc)}</td>
      <td>${arts(r).map((a) => `<span class="art">${esc(a.a)}</span>`).join(' ')}</td></tr>`).join('');

const html = `<!doctype html><html><head><meta charset="utf-8"><title>adidas / S&amp;S SKU Conversion Key</title>
<style>
  /* Sized for a packing station: this gets printed and read at arm's length under
     warehouse light, so body text is 11pt and the numbers themselves are larger
     and bolder than the words around them. */
  @page { size: letter; margin: 14mm 12mm 16mm; }
  * { box-sizing: border-box; }
  body { font-family: "Liberation Sans", Arial, Helvetica, sans-serif; color: #10171f; margin: 0;
         font-size: 11pt; line-height: 1.45; }
  .mono, .art, .ixto, .gstyle { font-family: "DejaVu Sans Mono", "Liberation Mono", monospace; }

  .cover { border-top: 6px solid #1b3a5c; padding-top: 16px; }
  h1 { font-size: 26pt; margin: 0 0 3px; letter-spacing: -.4px; }
  .sub { font-size: 13pt; color: #40536b; }
  .meta { font-size: 9.5pt; color: #78848f; margin-bottom: 18px; }

  .lead { background: #f2f6fa; border-left: 5px solid #1b3a5c; padding: 13px 16px; margin: 0 0 16px; }
  .lead h2 { font-size: 12pt; margin: 0 0 7px; text-transform: uppercase; letter-spacing: .7px; color: #1b3a5c; }
  .lead p { margin: 0 0 8px; }
  .lead p:last-child { margin-bottom: 0; }
  .eg { background: #fff; border: 1px solid #d3dde7; padding: 10px 13px; margin-top: 11px; }
  .eg b { color: #1b3a5c; }

  h2.sec { font-size: 15pt; margin: 0 0 4px; padding-bottom: 6px; border-bottom: 3px solid #1b3a5c; }
  .hint { font-size: 10pt; color: #4e5c6b; margin: 0 0 10px; }

  /* Three columns, not four: fewer, larger entries read faster than more, smaller ones. */
  .index { column-count: 3; column-gap: 16px; column-rule: 1px solid #dde4ec; }
  .ix { break-inside: avoid; padding: 3.5px 2px; border-bottom: .5px solid #eef1f5;
        display: flex; justify-content: space-between; align-items: baseline; gap: 6px; }
  .ix .mono { font-weight: bold; font-size: 12pt; letter-spacing: .3px; }
  .ixto { color: #40536b; font-size: 10.5pt; }

  /* Section 2 flows in two columns: every row carries one article number now, so
     the width went unused and the section ran twice as long as it needed to. A block
     is a whole garment, kept intact so a header never strands from its colours. */
  .keycols { column-count: 2; column-gap: 18px; }
  .blk { break-inside: avoid; margin-bottom: 9px; }
  .blkh { background: #e7edf4; border-top: 2px solid #1b3a5c; border-bottom: 1px solid #b9cbdd;
          font-weight: bold; font-size: 10.5pt; padding: 5px 7px; }
  .krow { display: flex; align-items: baseline; gap: 6px; padding: 4px 7px;
          border-bottom: 1px solid #eef1f5; }
  .krow:nth-child(even) { background: #fafbfc; }
  .ksku { font-size: 10.5pt; font-weight: bold; white-space: nowrap; }
  .kcol { flex: 1; font-size: 9.5pt; color: #40536b; }
  .kart { white-space: nowrap; }

  table { width: 100%; border-collapse: collapse; }
  th { background: #1b3a5c; color: #fff; font-size: 9pt; text-transform: uppercase; letter-spacing: .6px;
       text-align: left; padding: 7px 8px; }
  td { padding: 6.5px 8px; border-bottom: 1px solid #e6ebf0; vertical-align: baseline; }
  tbody tr:nth-child(even of :not(.grp)) td { background: #fafbfc; }
  tr.grp td { background: #e7edf4; font-weight: bold; font-size: 11.5pt; padding: 8px;
              border-top: 2px solid #1b3a5c; border-bottom: 1px solid #b9cbdd; }
  .gstyle { color: #1b3a5c; margin-right: 10px; }
  .hdrsz { margin-left: 10px; font-weight: normal; font-size: 9pt; color: #78848f; letter-spacing: .2px; }
  .art { background: #eaf1f8; border: 1px solid #a8c2da; padding: 2px 7px; font-size: 12pt;
         font-weight: bold; white-space: nowrap; letter-spacing: .3px; }
  .oos { font-size: 8.5pt; color: #8a6d3b; background: #fdf6e3; border: 1px solid #e8d9a8;
         padding: 1px 5px; white-space: nowrap; }
  .nowrap { white-space: nowrap; }
  td.mono { font-size: 11.5pt; font-weight: bold; }
  tr.warn td { background: #fff8e8; }
  .flag { background: #b45309; color: #fff; font-size: 8pt; padding: 1px 5px;
          text-transform: uppercase; letter-spacing: .4px; }

  thead { display: table-header-group; }
  tr { break-inside: avoid; }
  .page { break-before: page; }
  .note { font-size: 9.5pt; color: #4e5c6b; background: #fbfcfd; border: 1px solid #e6ebf0;
          padding: 11px 14px; margin-top: 14px; }
</style></head><body>

<div class="cover">
  <h1>adidas &harr; S&amp;S SKU Conversion Key</h1>
  <div class="sub">National Sports Apparel &rarr; Silverscreen Decoration &amp; Fulfillment</div>
  <div class="meta">Generated ${esc(stamp)} &nbsp;·&nbsp; ${matched.length} style/colours &nbsp;·&nbsp; ${rev.length} adidas article numbers</div>
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

<h2 class="sec">1 &nbsp;Tag index &mdash; look up the number on the garment</h2>
<p class="hint">Find the article number printed on the garment tag, and it gives you the S&amp;S SKU it fills.
   For the colour and full detail, look that SKU up in section 2.${
     conflicting.size ? ' <span class="flag">check</span> means the number matches more than one style &mdash; confirm with us before packing.' : ''}</p>
<div class="index">${revIndex}</div>

<div class="page"></div>
<h2 class="sec">2 &nbsp;The key &mdash; look up the number on the paperwork</h2>
<p class="hint">The adidas article number that fills each ordered style and colour. Where two are listed,
   both are in current production for that colour and either one is correct. Sizes are shown once per
   garment. <span class="oos">none in stock</span> means the number is right but nothing is on the shelf
   at present &mdash; check with us if that is what you were expecting.</p>
<div class="keycols">${fwdRows}</div>

${dupRows ? `<div class="page"></div>
<h2 class="sec">3 &nbsp;Confirm the shade by eye</h2>
<p class="hint">For these colours adidas splits shades that our system records under one name &mdash; kelly,
   team green and dark green all read "Dark Green". Any of the numbers below is the right
   <b>garment</b>; please confirm the <b>shade</b> against the approved sample before packing.</p>
<table>
  <thead><tr><th style="width:16%">S&amp;S SKU</th><th style="width:30%">Garment</th>
    <th style="width:22%">Colour ordered</th><th style="width:32%">Articles sharing this colour</th></tr></thead>
  <tbody>${dupRows}</tbody>
</table>` : ''}

${openRows ? `<h2 class="sec" style="margin-top:20px">${dupRows ? '4' : '3'} &nbsp;Not yet cross-referenced</h2>
<p class="hint">We have not yet matched an adidas article to these S&amp;S colours &mdash; we have not bought
   them recently, so no tagged stock has come through. If one of these arrives and the tag doesn't match,
   flag it to us and we will add it to the next revision.</p>
<table>
  <thead><tr><th style="width:18%">S&amp;S SKU</th><th style="width:46%">Garment</th><th style="width:36%">Colour</th></tr></thead>
  <tbody>${openRows}</tbody>
</table>` : ''}

<div class="note"><b>How this was built.</b> Cross-referenced from National Sports Apparel's product
  catalog: the adidas Team range synced from the S&amp;S Activewear API against the adidas article numbers
  on our own stock, matched by garment and colour. Superseded numbers from earlier seasons are
  deliberately left out. Questions, or a number that isn't listed &mdash; contact National Sports Apparel
  and we will confirm and reissue.</div>

</body></html>`;

const tmp = path.join(require('os').tmpdir(), `adidas-key-${process.pid}.html`);
fs.writeFileSync(tmp, html);
execFileSync(CHROME, ['--headless', '--disable-gpu', '--no-sandbox', '--no-pdf-header-footer',
  `--print-to-pdf=${OUT}`, 'file://' + tmp], { stdio: 'inherit' });
fs.unlinkSync(tmp);
console.log(`${OUT}  (${matched.length} matched, ${rev.length} article rows, ${unmatched.length} open, ${conflicting.size} conflicting)`);
