// ─────────────────────────────────────────────────────────────────────────────
// Production Work Order sheet — the "National Team Shop" floor sheet design
// (Claude Design handoff, NTS bundle). Pure presentational renderer: it takes a
// fully-prepared `data` object and returns a self-contained HTML document. All
// portal lookups (colors→hex, mockup URLs, DST barcodes, siblings, roster
// pairing) happen in the caller (buildWorkOrderOpts in App.js) so this module
// stays free of app/React dependencies and can be unit-tested and rendered in
// plain Node.
//
// Two mockup treatments, chosen by how many mock panels the job has:
//   • 1 panel  → SINGLE (front-only): mock + spec side-by-side, pick list on p1.
//   • 2 panels → DUAL   (front + back): mocks two-up, spec full-width, pick list
//                on its own page.
// A names/numbers roster prints on its own final page when present.
//
// Unlike the fixed-height design artboard, sheets use min-height + real page
// breaks so variable-length jobs (many lines, long rosters) never clip.
// ─────────────────────────────────────────────────────────────────────────────

const C = {
  navy: '#192853', navyDark: '#0F1A38', red: '#962C32', ink: '#1A1F2B',
  gray: '#8A90A2', gray2: '#98A0B2', slate: '#5A6075',
  line: '#E2E7F0', line2: '#EEF1F6', panel: '#F6F8FC', panel2: '#FAFBFD',
  amberBg: '#FFF9F0', amberBd: '#F5D9A8', amberInk: '#7A5410', amberLbl: '#8A5A00',
};

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]
));

// Fallback garment schematic (used only when a job has no real mockup image).
const garmentSvg = (fill, crest, hasBack, backArt, w = 126, h = 140) => {
  const front = `<svg width="${w}" height="${h}" viewBox="0 0 180 200" fill="none"><path d="M56 20 L36 34 L18 56 L34 74 L48 64 L48 180 Q48 186 54 186 L126 186 Q132 186 132 180 L132 64 L146 74 L162 56 L144 34 L124 20 Q112 34 90 34 Q68 34 56 20 Z" fill="${fill || '#22345c'}" stroke="#C9CFDD" stroke-width="1.5"/></svg>`;
  if (!hasBack) {
    return `<div style="position:relative;display:inline-block">${front}`
      + `<div style="position:absolute;left:31%;top:33%;transform:translate(-50%,-50%);width:16%;aspect-ratio:1;border:2px dashed ${C.red};border-radius:5px;display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,0.78)"><span style="font-family:'Barlow Condensed',sans-serif;font-weight:700;font-size:14px;color:${C.navy}">${esc(crest)}</span></div>`
      + `</div>`;
  }
  const back = `<svg width="${w}" height="${h}" viewBox="0 0 180 200" fill="none"><path d="M56 20 L36 34 L18 56 L34 74 L48 64 L48 180 Q48 186 54 186 L126 186 Q132 186 132 180 L132 64 L146 74 L162 56 L144 34 L124 20 Q108 30 90 30 Q72 30 56 20 Z" fill="${fill || '#22345c'}" stroke="#C9CFDD" stroke-width="1.5"/></svg>`;
  return `<div style="position:relative;display:inline-block">${back}`
    + `<div style="position:absolute;left:50%;top:40%;transform:translate(-50%,-50%);border:2px dashed ${C.red};border-radius:5px;padding:4px 12px;background:rgba(255,255,255,0.78)"><span style="font-family:'Barlow Condensed',sans-serif;font-weight:700;font-size:14px;color:${C.navy};letter-spacing:0.05em">${esc(backArt)}</span></div>`
    + `</div>`;
};

// One mock panel: the real approved-proof image when present, else the schematic.
const mockCell = (m, fill, crest) => {
  const label = `<div style="display:flex;align-items:baseline;justify-content:center;gap:10px;margin-bottom:6px"><span style="font-size:10px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:${C.gray2}">${esc(m.label)}</span>${m.dim ? `<span style="font-size:12px;color:${C.slate};font-weight:700">${esc(m.dim)}</span>` : ''}</div>`;
  const body = m.imgUrl
    ? `<img src="${esc(m.imgUrl)}" alt="${esc(m.label)}" style="max-height:196px;max-width:100%;object-fit:contain;border-radius:6px;border:1px solid ${C.line};background:#fff"/>`
    : garmentSvg(fill, crest, m.side === 'back', m.backArt);
  return `<div style="padding:8px 16px;text-align:center;background:linear-gradient(180deg,#FCFDFE,#F3F5FA)">${label}<div style="position:relative;display:inline-block;margin:0 auto">${body}</div></div>`;
};

const panelHead = (t) => `<div style="background:${C.panel};padding:8px 14px;border-bottom:1px solid ${C.line};font-family:'Barlow Condensed',sans-serif;text-transform:uppercase;font-weight:700;font-size:12px;letter-spacing:0.05em;color:${C.navy}">${esc(t)}</div>`;

const header = (d, subtitle, right, refLabel) => `
  <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:20px;border-bottom:3px solid ${C.navy};padding-bottom:16px">
    <div style="display:flex;align-items:flex-start;gap:13px">
      <span style="width:44px;height:44px;border-radius:9px;background:${C.navy};color:#fff;display:flex;align-items:center;justify-content:center;font-family:'Barlow Condensed',sans-serif;font-weight:700;font-size:22px">NT</span>
      <div style="line-height:1.05">
        <div style="font-family:'Barlow Condensed',sans-serif;text-transform:uppercase;font-weight:600;font-size:22px;letter-spacing:0.08em;color:${C.navy}">${esc(d.brandName || 'National Team Shop')}</div>
        <div style="font-size:11px;color:${C.gray};letter-spacing:0.04em">${esc(subtitle)}</div>
        ${refLabel ? `<div style="margin-top:7px;font-size:11px;color:${C.gray};letter-spacing:0.12em;font-family:'Barlow Condensed',sans-serif">${esc(refLabel)}</div>` : ''}
      </div>
    </div>
    <div style="text-align:right">
      <div style="font-family:'Barlow Condensed',sans-serif;text-transform:uppercase;font-weight:700;font-size:13px;letter-spacing:0.1em;color:${C.gray}">Work Order</div>
      <div style="font-family:'Barlow Condensed',sans-serif;font-weight:700;font-size:32px;color:${C.navy};line-height:1;letter-spacing:0.02em">${esc(d.id)}</div>
      ${right}
    </div>
  </div>`;

const metaGrid = (meta) => `
  <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:1px;background:${C.line};border:1px solid ${C.line};margin-top:10px">
    ${(meta || []).map((m) => `<div style="background:#fff;padding:8px 12px"><div style="font-size:9.5px;font-weight:700;letter-spacing:0.07em;text-transform:uppercase;color:${C.gray2};margin-bottom:3px">${esc(m.k)}</div><div style="font-size:13.5px;font-weight:600;color:${m.color || C.navy}">${esc(m.v)}</div></div>`).join('')}
  </div>`;

const specPanel = (d) => {
  const specs = (d.specs || []).map((sp) => `<div><div style="font-size:9px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:${C.gray2}">${esc(sp.k)}</div><div style="font-size:12.5px;font-weight:600;color:${C.navy}">${esc(sp.v)}</div></div>`).join('');
  const colors = (d.colors || []).map((c) => `<div style="display:flex;align-items:center;gap:9px"><span style="width:22px;height:22px;border-radius:5px;background:${esc(c.hex || '#e2e8f0')};border:1px solid rgba(0,0,0,0.1);flex:none"></span><span style="font-size:12px;font-weight:600;color:${C.navy};min-width:44px">${esc(c.name)}</span>${c.code ? `<span style="font-size:11px;color:${C.gray}">${esc(c.code)}</span>` : ''}</div>`).join('');
  return `<div style="border:1px solid ${C.line};border-radius:8px;overflow:hidden">${panelHead('Decoration Spec')}
    <div style="padding:12px 14px">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px 14px">${specs}</div>
      ${colors ? `<div style="border-top:1px solid ${C.line2};margin-top:9px;padding-top:9px"><div style="font-size:9px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:${C.gray2};margin-bottom:8px">${esc(d.colorsLabel || 'Colors')}</div><div style="display:flex;flex-wrap:wrap;gap:7px 18px">${colors}</div></div>` : ''}
    </div>
  </div>`;
};

const dstBlock = (d) => {
  if (d.dstWarning) {
    return `<div style="margin-top:10px;padding:9px 12px;background:#FEF2F2;border:2px solid #FECACA;border-radius:8px;font-size:12px;font-weight:800;color:#B91C1C">⚠ NO DST FILE ATTACHED — upload the digitizer's .DST to this job's art files to print machine barcodes.</div>`;
  }
  if (!d.dstBarcodes || !d.dstBarcodes.length) return '';
  const items = d.dstBarcodes.map((b) => `<div style="text-align:center"><div style="display:inline-block;background:#fff">${b.svg || `<div style="font-size:12px;font-weight:700;padding:8px">${esc(b.base)}</div>`}</div>${(b.dg || b.art) ? `<div style="font-size:10px;font-weight:700;color:#334155">${esc([b.dg, b.art].filter(Boolean).join(' · '))}</div>` : ''}</div>`).join('');
  return `<div style="margin-top:10px;padding:10px 12px;background:#fff;border:2px solid #1e293b;border-radius:8px;page-break-inside:avoid">
    <div style="font-size:13px;font-weight:800;color:#1e293b">🧵 MACHINE DESIGNS — SCAN TO LOAD</div>
    <div style="font-size:9px;color:#64748b;margin-bottom:8px">Barcode = DST file name. Scan at the machine to pull the design from the design server.</div>
    <div style="display:flex;gap:18px;flex-wrap:wrap">${items}</div>
  </div>`;
};

const lineItems = (d) => {
  const head = `<div style="display:grid;grid-template-columns:1.7fr 1fr 2.5fr 1fr 58px;gap:8px;padding:8px 14px;background:${C.panel2};border-bottom:1px solid ${C.line2};font-size:9.5px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:${C.gray2}"><span>Product</span><span>SKU</span><span>Size run</span><span>Decoration</span><span style="text-align:right">Qty</span></div>`;
  const rows = (d.lines || []).map((li) => {
    const sizes = (li.sizes || []).map((sz) => `<span style="display:inline-flex;flex-direction:column;align-items:stretch;border:1px solid #D5DBE6;border-radius:5px;overflow:hidden;min-width:30px;flex:none"><span style="font-size:8.5px;font-weight:700;color:${C.slate};background:#F1F4F9;text-align:center;padding:1px 5px">${esc(sz.s)}</span><span style="font-family:'Barlow Condensed',sans-serif;font-size:14px;font-weight:700;color:${C.navy};text-align:center;padding:0 5px 1px">${esc(sz.q)}</span></span>`).join('');
    return `<div style="display:grid;grid-template-columns:1.7fr 1fr 2.5fr 1fr 58px;gap:8px;padding:8px 14px;border-bottom:1px solid #F4F6FA;align-items:center">
      <div><div style="font-size:12.5px;font-weight:600;color:${C.navy}">${esc(li.name)}</div><div style="font-size:11px;color:${C.gray}">${esc(li.color)}</div></div>
      <span style="font-size:11.5px;font-weight:600;color:#2A2F3E;font-family:'Barlow Condensed',sans-serif;letter-spacing:0.02em">${esc(li.sku)}</span>
      <div style="display:flex;flex-wrap:wrap;gap:4px">${sizes}</div>
      <span style="font-size:11.5px;color:${C.slate}">${esc(li.deco)}</span>
      <span style="text-align:right;font-family:'Barlow Condensed',sans-serif;font-weight:700;font-size:17px;color:${C.navy}">${esc(li.qty)}</span>
    </div>`;
  }).join('');
  return `<div style="margin-top:11px;border:1px solid ${C.line};border-radius:8px;overflow:hidden">
    <div style="background:${C.navy};color:#fff;padding:8px 14px;font-family:'Barlow Condensed',sans-serif;text-transform:uppercase;font-weight:700;font-size:13px;letter-spacing:0.05em">Line Items &amp; Pick List</div>
    ${head}${rows}
    <div style="display:flex;justify-content:flex-end;gap:14px;align-items:baseline;padding:10px 14px;background:${C.panel2}"><span style="font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:${C.gray}">Total pieces</span><span style="font-family:'Barlow Condensed',sans-serif;font-weight:700;font-size:22px;color:${C.navy}">${esc(d.totalPieces)}</span></div>
  </div>`;
};

const siblingsBlock = (sib) => {
  if (!sib || !sib.list || !sib.list.length) return '';
  const items = sib.list.map((s) => `<li>${esc(s.soId)} · ${esc(s.cust)} — ${esc(s.qty)} units${s.pending ? ' ⚠️ items pending' : ''}${s.matched ? ' (matched by art)' : ''}</li>`).join('');
  return `<div style="margin-top:11px;padding:10px 12px;background:#eef2ff;border:1px solid #c7d2fe;border-radius:8px;page-break-inside:avoid"><div style="font-size:12px;font-weight:700;color:#3730a3">🔗 Runs together — reuse one setup (${esc(sib.unitsTotal)} units total)</div><ul style="margin:6px 0 0;padding-left:18px;font-size:12px;color:#3730a3">${items}</ul></div>`;
};

const prodFilesBlock = (files) => {
  if (!files || !files.length) return '';
  const rows = files.map((f) => `<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid #F4F6FA;font-size:11px"><span style="color:${C.slate}">Production</span><span style="color:${C.navy};font-weight:600">${esc(f)}</span></div>`).join('');
  return `<div style="margin-top:11px;border:1px solid ${C.line};border-radius:8px;overflow:hidden"><div style="background:${C.panel};padding:7px 14px;font-family:'Barlow Condensed',sans-serif;text-transform:uppercase;font-weight:700;font-size:12px;letter-spacing:0.05em;color:${C.navy}">Production Files</div><div style="padding:6px 14px">${rows}</div></div>`;
};

const instructions = (notes) => notes
  ? `<div style="margin-top:11px;border:1px solid ${C.amberBd};background:${C.amberBg};border-radius:8px;padding:9px 14px"><div style="font-size:9.5px;font-weight:700;letter-spacing:0.07em;text-transform:uppercase;color:${C.amberLbl};margin-bottom:3px">Special Instructions</div><div style="font-size:12.5px;line-height:1.5;color:${C.amberInk}">${esc(notes)}</div></div>`
  : '';

const signoff = (roles) => `<div style="margin-top:12px;display:grid;grid-template-columns:repeat(4,1fr);gap:14px">${(roles || []).map((s) => `<div><div style="border-bottom:1.5px solid ${C.ink};height:20px"></div><div style="font-size:9.5px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:${C.gray};margin-top:4px">${esc(s.role || s)}</div><div style="font-size:10px;color:#B0B6C4">Initials + date</div></div>`).join('')}</div>`;

const footer = (left, mid, right) => `<div style="margin-top:13px;display:flex;justify-content:space-between;align-items:center;border-top:1px solid ${C.line};padding-top:9px;font-size:10.5px;color:${C.gray2}"><span>${esc(left)}</span><span>${esc(mid)}</span><span>${esc(right)}</span></div>`;

const sheet = (inner, extraStyle = '') => `<div class="wo-sheet" style="width:816px;min-height:1056px;padding:30px 46px;box-shadow:0 20px 60px -20px rgba(0,0,0,0.5);position:relative;${extraStyle}">${inner}</div>`;

// ── Roster page (names & numbers) ──
const rosterPage = (d, r, pageLabel) => {
  const summary = (r.summary || []).map((ss) => `<div style="border:1px solid #D5DBE6;border-radius:8px;overflow:hidden;min-width:58px;text-align:center"><div style="background:${C.navy};color:#fff;font-size:11px;font-weight:700;padding:4px">${esc(ss.s)}</div><div style="font-family:'Barlow Condensed',sans-serif;font-size:22px;font-weight:700;color:${C.navy};padding:5px">${esc(ss.q)}</div></div>`).join('')
    + `<div style="border:1px solid ${C.navy};border-radius:8px;overflow:hidden;min-width:64px;text-align:center"><div style="background:${C.red};color:#fff;font-size:11px;font-weight:700;padding:4px">TOTAL</div><div style="font-family:'Barlow Condensed',sans-serif;font-size:22px;font-weight:700;color:${C.navy};padding:5px">${esc(r.total)}</div></div>`;
  const groupHtml = (g) => `<div style="display:flex;justify-content:space-between;align-items:center;background:#F1F4F9;padding:3px 14px;border-bottom:1px solid ${C.line}"><span style="font-family:'Barlow Condensed',sans-serif;font-weight:700;font-size:13px;color:${C.navy}">Size ${esc(g.size)}</span><span style="font-size:10.5px;font-weight:600;color:${C.gray}">${esc(g.count)} pcs</span></div>`
    + (g.players || []).map((p) => `<div style="display:grid;grid-template-columns:34px 1fr auto;gap:8px;padding:2px 14px;border-bottom:1px solid #F4F6FA;align-items:center"><span style="font-family:'Barlow Condensed',sans-serif;font-weight:700;font-size:14px;color:${C.red}">${esc(p.num)}</span><span style="font-size:12px;color:#2A2F3E;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(p.name)}</span><span style="font-size:11.5px;font-weight:700;color:${C.navy};letter-spacing:0.03em">${esc(p.back)}</span></div>`).join('');
  // split groups into two roughly-even columns by piece count
  const groups = r.groups || [];
  const half = Math.ceil((r.total || 0) / 2);
  const left = []; const rightG = []; let acc = 0;
  groups.forEach((g) => { if (acc < half) { left.push(g); acc += g.count; } else { rightG.push(g); } });
  const inner = `
    ${header(d, 'Personalization list · sorted by size', `<div style="margin-top:5px;font-size:11px;color:${C.gray}">${esc(r.title || '')}</div>`)}
    <div style="margin-top:9px;border:1px solid ${C.line};border-radius:8px;padding:9px 14px;display:grid;grid-template-columns:repeat(4,1fr);gap:12px">
      ${(r.personalization || []).map((p) => `<div><div style="font-size:9px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:${C.gray2};margin-bottom:3px">${esc(p.k)}</div><div style="font-size:12.5px;font-weight:600;color:${C.navy}">${esc(p.v)}</div></div>`).join('')}
    </div>
    <div style="margin-top:9px"><div style="font-size:9.5px;font-weight:700;letter-spacing:0.07em;text-transform:uppercase;color:${C.gray2};margin-bottom:6px">Size run · ${esc(r.garment || '')}</div><div style="display:flex;gap:8px;flex-wrap:wrap">${summary}</div></div>
    <div style="margin-top:9px;border:1px solid ${C.line};border-radius:8px;overflow:hidden">
      <div style="background:${C.navy};color:#fff;padding:8px 14px;display:flex;justify-content:space-between;align-items:center"><span style="font-family:'Barlow Condensed',sans-serif;text-transform:uppercase;font-weight:700;font-size:13px;letter-spacing:0.05em">Player Roster</span><span style="font-size:10px;letter-spacing:0.05em;color:rgba(255,255,255,0.65)">NO. · PLAYER · NAME ON BACK</span></div>
      <div style="display:grid;grid-template-columns:1fr 1fr"><div style="border-right:1px solid ${C.line}">${left.map(groupHtml).join('')}</div><div>${rightG.map(groupHtml).join('')}</div></div>
    </div>
    <div style="margin-top:9px;font-size:10.5px;color:${C.gray};line-height:1.45">Verify all spellings against the coach-approved roster before pressing. Flag any TBD / add-on players to the account rep.</div>
    ${footer(d.footerLeft, `${esc(d.id)} · Roster`, pageLabel)}`;
  return sheet(inner, 'margin-top:24px;');
};

// Pair per-size jersey-number arrays with per-size name arrays BY INDEX. It does
// NOT sort within a size — sorting would break the number↔name alignment that
// roster-seeded orders rely on (numbers/names are stored as two parallel arrays,
// aligned only by position). Sizes are ordered by `szOrder` for legible output.
// Returns { groups:[{size,count,players:[{num,name,back}]}], total }.
export function pairRoster(rosterMap = {}, namesMap = {}, szOrder = []) {
  const rank = (s) => (szOrder.indexOf(s) < 0 ? 99 : szOrder.indexOf(s));
  const allSz = [...new Set([...Object.keys(rosterMap), ...Object.keys(namesMap)])].sort((a, b) => rank(a) - rank(b));
  const groups = allSz.map((sz) => {
    const nums = rosterMap[sz] || []; const nms = namesMap[sz] || [];
    const n = Math.max(nums.length, nms.length); const players = [];
    for (let i = 0; i < n; i++) {
      const number = nums[i] != null && nums[i] !== '' ? String(nums[i]) : '';
      const name = nms[i] || '';
      if (!number && !name) continue;
      players.push({ num: number, name, back: String(name || '').toUpperCase() });
    }
    return { size: sz, count: players.length, players };
  }).filter((g) => g.count > 0);
  return { groups, total: groups.reduce((a, g) => a + g.count, 0) };
}

// ── Main entry ──
export function buildWorkOrderDoc(data) {
  const d = data || {};
  const mocks = d.mocks || [];
  const dual = mocks.length > 1;
  const hasRoster = !!(d.roster && d.roster.groups && d.roster.groups.length);
  const rushMethod = `<div style="margin-top:6px;display:inline-flex;align-items:center;gap:7px">${d.rush ? `<span style="font-size:10px;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;color:#fff;background:${C.red};padding:3px 8px;border-radius:4px">Rush</span>` : ''}<span style="font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:${C.navy};border:1px solid #C9CFDD;padding:3px 8px;border-radius:4px">${esc(d.methodName)}</span></div>`;

  // page count for footers
  const totalPages = 1 + (dual ? 1 : 0) + (hasRoster ? 1 : 0);
  let pageNo = 0;
  const pg = () => { pageNo += 1; return totalPages > 1 ? `Page ${pageNo} of ${totalPages}` : ''; };

  // Mockup section (single = mock+spec side-by-side; dual = two-up + spec below)
  let mockSection;
  if (dual) {
    mockSection = `<div style="margin-top:10px;border:1px solid ${C.line};border-radius:8px;overflow:hidden">${panelHead('Approved Mockup')}<div style="display:grid;grid-template-columns:1fr 1fr">${mockCell({ ...mocks[0], side: 'front' }, d.garmentFill, d.crest)}<div style="border-left:1px solid ${C.line2}">${mockCell({ ...mocks[1], side: 'back' }, d.garmentFill, d.crest)}</div></div></div>
      <div style="margin-top:10px">${specPanel(d)}</div>${dstBlock(d)}`;
  } else {
    mockSection = `<div style="margin-top:10px;display:grid;grid-template-columns:0.95fr 1.05fr;gap:14px;align-items:start">
      <div style="border:1px solid ${C.line};border-radius:8px;overflow:hidden">${panelHead('Approved Mockup')}${mockCell({ ...(mocks[0] || { label: 'Front', side: 'front' }) }, d.garmentFill, d.crest)}</div>
      <div>${specPanel(d)}</div>
    </div>${dstBlock(d)}`;
  }

  // Line items live on page 1 for single, page 2 for dual (matches the design).
  const p1Lines = dual ? '' : lineItems(d) + prodFilesBlock(d.prodFiles) + siblingsBlock(d.siblings);

  const page1 = sheet(`
    ${header(d, 'Production Work Order · Decoration Floor', rushMethod, d.barcodeLabel || d.id)}
    ${metaGrid(d.meta)}
    ${mockSection}
    ${p1Lines}
    ${instructions(d.notes)}
    ${signoff(d.signoff)}
    ${footer(d.footerLeft, d.companyLine || 'National Team Shop · A National Sports Apparel company', pg())}
  `);

  let pages = page1;
  if (dual) {
    pages += sheet(`
      ${header(d, 'Garments · sizes · decoration', `<div style="margin-top:5px;font-size:11px;color:${C.gray}">${esc(d.methodName)} · ${esc(d.totalPieces)} pcs</div>`)}
      ${lineItems(d)}
      ${prodFilesBlock(d.prodFiles)}
      ${siblingsBlock(d.siblings)}
      ${footer(d.footerLeft, `${esc(d.id)} · Line items`, pg())}
    `, 'margin-top:24px;');
  }
  if (hasRoster) pages += rosterPage(d, d.roster, pg());

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@400;500;600;700&family=Source+Sans+3:wght@300;400;500;600;700&display=swap" rel="stylesheet">
<title>Work Order ${esc(d.id)}</title>
<style>
  *{box-sizing:border-box}html,body{margin:0;padding:0}
  body{background:#6b7280;font-family:'Source Sans 3',system-ui,-apple-system,Segoe UI,sans-serif;color:${C.ink};-webkit-font-smoothing:antialiased}
  .wo-screen-pad{padding:24px;display:flex;flex-direction:column;align-items:center}
  .wo-sheet{background:#fff}
  @media print{
    body{background:#fff}
    .wo-screen-pad{padding:0}
    .wo-sheet{box-shadow:none!important;margin:0!important}
    .wo-sheet + .wo-sheet{page-break-before:always;break-before:page}
  }
  @page{size:letter portrait;margin:0}
</style></head><body><div class="wo-screen-pad">${pages}</div></body></html>`;
}

export default buildWorkOrderDoc;
