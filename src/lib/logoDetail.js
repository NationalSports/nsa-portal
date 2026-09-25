import { safeArr, safeArt, safeItems, safeStr, jobItemArtSlots, jobArtFileIds, markArtFieldEdit } from '../safeHelpers';
import { pickCwAsset } from '../businessLogic';
import { knownGarmentHex, exactGarmentHex } from './artGrid';

// ── Logo detail ──
// Every garment mock has a partner: the LOGO DETAIL, a close-up of the logo alone that the floor,
// the rep and the coach read ink colors and small type from. It is the design's web logo (a
// transparent PNG) for the color way that garment prints, so it doubles as the webstore cutout.
// It lives in the existing per-color-way web_logos[] model (ARTWORK_CW_WEBLOGO_MODEL) — nothing new
// is stored. Displays paint the garment color behind the transparent PNG.

// The logo detail for a design + color way: exact color way, then the "all garments" default,
// then the legacy single web_logo_url. preview_url is a design thumbnail, not a cutout, so it
// never counts as a logo detail.
export const logoDetailUrl = (art, colorWayId) =>
  art ? pickCwAsset({ ...art, preview_url: '' }, { kind: 'web_logo', colorWayId: colorWayId || null }) : '';

// Background behind the transparent logo — the color of the garment it is printed on:
//  1. the garment line's own color when it names a real color. A logo used on several garment
//     colors therefore shows on EACH garment's color. Two-tone names use the first color
//     ("Light Blue/White" → light blue); the B side of a reversible uses the second.
//  2. else ("CUSTOM", blank, an unknown vendor name) the color way's garment color — but only
//     when that label IS a color ("Navy"), never an ink description ("White ink on dark").
//  3. else a neutral mid grey that keeps white AND dark inks readable. (The mock card also tries
//     reading the shirt color off the mock image before settling for this.)
// source: 'garment' | 'colorway' | 'unknown'.
export const UNKNOWN_GARMENT_BG = '#94a3b8';
const _sideColor = (color, side) => {
  const parts = safeStr(color).split('/').map(x => x.trim()).filter(Boolean);
  return (side === 'B' && parts[1]) || parts[0] || '';
};
export const logoDetailBackground = (color, cwColor, side) => {
  const own = _sideColor(color, side);
  const k = own && knownGarmentHex(own);
  if (k) return { bg: k, label: own, known: true, source: 'garment' };
  const cw = safeStr(cwColor).trim();
  const c = cw && (exactGarmentHex(cw) || exactGarmentHex(_sideColor(cw)));
  if (c) return { bg: c, label: cw, known: true, source: 'colorway' };
  return { bg: UNKNOWN_GARMENT_BG, label: '', known: false, source: 'unknown' };
};
export const logoDetailBg = (color, cwColor, side) => logoDetailBackground(color, cwColor, side).bg;
// The garment color a color way is designed for ("Navy"), used when the line's own color is unknown.
export const cwGarmentColor = (art, colorWayId) =>
  colorWayId ? safeStr(safeArr(art?.color_ways).find(c => c && c.id === colorWayId)?.garment_color).trim() : '';

const _cwLabel = (art, colorWayId) => {
  const cw = safeArr(art?.color_ways).find(c => c && c.id === colorWayId);
  return safeStr(cw?.garment_color).trim() || colorWayId;
};
const _isDefaultLogo = (w) => !!(w && (w.is_default || (!w.color_way_id && !safeStr(w.color_way).trim())));

// Save a logo detail on one design. With a color way it is that color way's web logo; without one
// it is the design's "all garments" default (mirrored to web_logo_url, like the Art Library does).
// The color_way label is always filled in: a blank label reads as the default everywhere else.
export const setLogoDetail = (arts, artId, colorWayId, file) => {
  const url = safeStr(typeof file === 'string' ? file : file?.url);
  if (!url || !artId) return safeArr(arts);
  const name = typeof file === 'object' && file?.name ? file.name : undefined;
  return safeArr(arts).map(a => {
    if (!a || a.id !== artId) return a;
    const entry = colorWayId
      ? { url, ...(name ? { name } : {}), color_way_id: colorWayId, color_way: _cwLabel(a, colorWayId) }
      : { url, ...(name ? { name } : {}), color_way: '', is_default: true };
    const keep = safeArr(a.web_logos).filter(w => w && w.url && (colorWayId ? w.color_way_id !== colorWayId : !_isDefaultLogo(w)));
    // Newest first (resolvers take the first match), and the replaced entry is marked as an
    // intentional removal so a conflict merge can't bring the old logo back.
    const next = markArtFieldEdit(a, 'web_logos', [entry, ...keep]);
    return colorWayId ? next : markArtFieldEdit(next, 'web_logo_url', url);
  });
};

// Remove one logo detail image (by url) from a design.
export const removeLogoDetail = (arts, artId, url) => safeArr(arts).map(a => {
  if (!a || a.id !== artId || !url) return a;
  const next = markArtFieldEdit(a, 'web_logos', safeArr(a.web_logos).filter(w => w && w.url !== url));
  return a.web_logo_url === url ? markArtFieldEdit(next, 'web_logo_url', '') : next;
});

// Every (design, color way) pair this job prints — one logo detail each. Scoped like the mock
// gate: only the decorations this job owns, only designs that belong to the job.
export const jobLogoDetailNeeds = (job, so) => {
  const arts = safeArt(so);
  const soItems = safeItems(so);
  const jobArtIds = jobArtFileIds(job, soItems);
  const out = new Map();
  safeArr(job?.items).forEach(gi => {
    const it = soItems[gi?.item_idx];
    if (!it) return;
    jobItemArtSlots(gi, it).forEach(({ d }) => {
      if (!jobArtIds.has(d.art_file_id)) return;
      const art = arts.find(a => a?.id === d.art_file_id);
      if (!art) return;
      const cws = [d.color_way_id || null, ...(d.reversible ? [d.color_way_id_b || null] : [])];
      cws.forEach(cw => {
        const key = art.id + '|' + (cw || '');
        if (!out.has(key)) out.set(key, { art, colorWayId: cw, label: (art.name || 'Artwork') + (cw ? ' (' + _cwLabel(art, cw) + ')' : '') });
      });
    });
  });
  return [...out.values()];
};

// Labels of the designs / color ways on this job that still have no logo detail.
export const jobMissingLogoDetails = (job, so) =>
  jobLogoDetailNeeds(job, so).filter(n => !logoDetailUrl(n.art, n.colorWayId)).map(n => n.label);

// The logo details to show beside one job garment's mock: one per design / color way it prints,
// deduped by image (per reversible side). [{ url, artName, cwLabel, side }]
export const garmentLogoDetails = (gi, so, artFiles) => {
  const line = safeItems(so)[gi?.item_idx];
  if (!line) return [];
  const seen = new Set();
  const out = [];
  jobItemArtSlots(gi, line).forEach(({ d }) => {
    const a = safeArr(artFiles).find(x => x?.id === d.art_file_id);
    if (!a) return;
    [[d.color_way_id || null, d.reversible ? 'A' : ''], ...(d.reversible ? [[d.color_way_id_b || null, 'B']] : [])].forEach(([cw, side]) => {
      const url = logoDetailUrl(a, cw);
      if (!url || seen.has(url + side)) return;
      seen.add(url + side);
      const cwObj = cw ? safeArr(a.color_ways).find(c => c && c.id === cw) : null;
      out.push({ url, artName: a.name || 'Artwork', cwLabel: safeStr(cwObj?.garment_color).trim(), side });
    });
  });
  return out;
};

// ── Keep the customer's Art Library in step ──
// A logo detail is the design's web logo, and webstores / the Previous Artwork picker / the Art
// Library read the LIBRARY copy of a design first. So a logo detail saved (or removed) on an order
// is applied to the matching library art too — same id, or same name + deco type (artWriteMatches'
// rule). Color ways are matched by id, then by garment-color label (library copies usually keep
// the order's ids). Only the one color way's entry changes; the library's other web logos stay.
// Placeholder names reps give art that doesn't exist yet ("ART TBD 1", "Untitled") repeat across a
// customer's orders, so they never identify the same design.
const _PLACEHOLDER_ART_NAME = /^(art\s*tbd\b.*|tbd\b.*|untitled.*|new art.*|art\s*\d*)$/i;
const _realName = a => { const n = safeStr(a?.name).trim(); return n && !_PLACEHOLDER_ART_NAME.test(n) ? n.toLowerCase() : ''; };
const _sameDesign = (lib, art) => !!lib && !!art && (lib.id === art.id || (
  _realName(lib) !== '' &&
  safeStr(lib.name).trim().toLowerCase() === safeStr(art.name).trim().toLowerCase() &&
  (lib.deco_type || '') === (art.deco_type || '')));
const _libCwId = (lib, art, cwId) => {
  if (!cwId) return null;
  if (safeArr(lib.color_ways).some(c => c && c.id === cwId)) return cwId;
  const lbl = _cwLabel(art, cwId).toLowerCase();
  const m = safeArr(lib.color_ways).find(c => c && safeStr(c.garment_color).trim().toLowerCase() === lbl);
  return m ? m.id : undefined; // undefined = the library design has no such color way
};
// change = { artId, colorWayId, url } to set, or { artId, removeUrl } to remove, applied to the
// order's art `orderArts`. Returns the updated library art array, or null when nothing changed.
export const logoDetailLibraryUpdate = (libArts, orderArts, change) => {
  const art = safeArr(orderArts).find(a => a && a.id === change?.artId);
  const idx = safeArr(libArts).findIndex(l => _sameDesign(l, art));
  if (!art || idx < 0) return null;
  const lib = libArts[idx];
  let next;
  if (change.removeUrl) {
    if (!safeArr(lib.web_logos).some(w => w && w.url === change.removeUrl) && lib.web_logo_url !== change.removeUrl) return null;
    next = removeLogoDetail([lib], lib.id, change.removeUrl)[0];
  } else {
    const cw = _libCwId(lib, art, change.colorWayId);
    if (cw === undefined) {
      // The library design lacks this color way: add it with the order's label so it can key on it.
      const src = safeArr(art.color_ways).find(c => c && c.id === change.colorWayId);
      if (!src) return null;
      const withCw = { ...lib, color_ways: [...safeArr(lib.color_ways), { ...src, inks: [...safeArr(src.inks)] }] };
      next = setLogoDetail([withCw], lib.id, src.id, change.url)[0];
    } else {
      if (logoDetailUrl(lib, cw) === change.url && safeArr(lib.web_logos).some(w => w && w.url === change.url)) return null;
      next = setLogoDetail([lib], lib.id, cw, change.url)[0];
    }
  }
  // Library rows are saved whole with the customer record; the order-save merge markers don't apply.
  const { _artDeletes, _artEditedFields, ...clean } = next;
  return libArts.map((l, i) => (i === idx ? clean : l));
};
// The customer records (own, then parent program) whose library holds this design, updated.
export const logoDetailCustomerUpdates = (customers, customerId, orderArts, change) => {
  const own = safeArr(customers).find(c => c && c.id === customerId);
  const chain = [own, own?.parent_id ? safeArr(customers).find(c => c && c.id === own.parent_id) : null].filter(Boolean);
  return chain.flatMap(c => {
    const arts = logoDetailLibraryUpdate(safeArr(c.art_files), orderArts, change);
    return arts ? [{ ...c, art_files: arts }] : [];
  });
};

// ── Apply an Art Library web-logo edit to one copy of the design ──
// The Art Library editor edits ONE representative copy of a design (`before` → `after` web_logos
// list) and fans the change out to the library and every order carrying the design. Replacing
// each copy's list wholesale wiped color-way logos that existed only on another order (e.g. a
// logo detail made on that job). This applies just the edit: removed images are removed, new or
// changed entries replace that color way's entry (matched by color_way_id, then label, then the
// "all garments" default), and entries the copy lacks are filled in — everything else stays.
// mark=true stamps the removals for the order-save merge (markArtFieldEdit) so they stick.
const _wlKey = (w, cws) => {
  if (!w) return '';
  if (w.is_default || (!w.color_way_id && !safeStr(w.color_way).trim())) return 'default';
  const byId = w.color_way_id && safeArr(cws).find(c => c && c.id === w.color_way_id);
  const lbl = safeStr(byId ? byId.garment_color : w.color_way).trim().toLowerCase();
  return lbl ? 'cw:' + lbl : 'id:' + w.color_way_id;
};
export const mergeWebLogoEdit = (target, before, after, { mark = true } = {}) => {
  if (!target) return target;
  const cws = safeArr(target.color_ways);
  const was = safeArr(before).filter(w => w && w.url);
  const now = safeArr(after).filter(w => w && w.url);
  const nowUrls = new Set(now.map(w => w.url));
  const removed = new Set(was.map(w => w.url).filter(u => !nowUrls.has(u)));
  const sig = w => w.url + '|' + _wlKey(w, cws);
  const wasSigs = new Set(was.map(sig));
  const changed = now.filter(w => !wasSigs.has(sig(w)));
  const restamp = w => {
    if (!w.color_way_id || cws.some(c => c.id === w.color_way_id)) return w;
    const lbl = safeStr(w.color_way).trim().toLowerCase();
    const m = lbl && cws.find(c => safeStr(c.garment_color).trim().toLowerCase() === lbl);
    if (m) return { ...w, color_way_id: m.id };
    const { color_way_id, ...rest } = w; return rest; // a foreign id would never resolve here
  };
  let list = safeArr(target.web_logos).filter(w => w && w.url && !removed.has(w.url));
  changed.forEach(w => { const k = _wlKey(w, cws); list = [restamp(w), ...list.filter(x => _wlKey(x, cws) !== k)]; });
  // Fill in color ways this copy has no logo for yet (the editor's list is the source of truth
  // for what the design has); never override the copy's own entry for a color way.
  now.forEach(w => { const k = _wlKey(w, cws); if (!list.some(x => _wlKey(x, cws) === k)) list.push(restamp(w)); });
  const def = (list.find(w => _wlKey(w, cws) === 'default') || {}).url
    || (removed.has(target.web_logo_url) ? '' : safeStr(target.web_logo_url));
  if (!mark) return { ...target, web_logos: list, web_logo_url: def };
  const next = markArtFieldEdit(target, 'web_logos', list);
  return def === safeStr(target.web_logo_url) ? next : markArtFieldEdit(next, 'web_logo_url', def);
};

// ── Reused art that still needs its web logo ──
// Previous art dropped onto a new order usually skips the artist (its mock is reused and it can
// go straight to approved), so the "Send for approval" logo-detail check never runs for it. This
// finds those designs so the Art Dashboard can ask for the PNG: jobs on open orders, past the
// artist stage, whose design is REUSED — it sits in the customer's (or parent program's) Art
// Library, or on another of the customer's orders — and whose color way has no logo detail yet.
// One entry per order + design + color way: [{ key, so, job, art, colorWayId, garmentColor, label }]
const _ARTIST_STAGES = ['needs_art', 'art_requested', 'art_in_progress'];
export const reusedLogoDetailNeeds = (jobs, sos, customers) => {
  const custById = new Map(safeArr(customers).filter(Boolean).map(c => [c.id, c]));
  const family = cid => { const c = custById.get(cid); const root = c?.parent_id || cid; return root; };
  const libOf = cid => { const c = custById.get(cid); const p = c?.parent_id ? custById.get(c.parent_id) : null; return [...safeArr(c?.art_files), ...safeArr(p?.art_files)]; };
  // Index every order's designs once (by program family): design_id and name+deco -> order ids.
  const idx = new Map();
  const _nk = a => safeStr(a.name).trim().toLowerCase() + '|' + (a.deco_type || '');
  safeArr(sos).forEach(o => { if (!o) return; const f = family(o.customer_id); safeArt(o).forEach(a => {
    [a.design_id ? 'd:' + a.design_id : '', _realName(a) ? 'n:' + _nk(a) : ''].filter(Boolean).forEach(k => {
      const key = f + '#' + k; if (!idx.has(key)) idx.set(key, new Set()); idx.get(key).add(o.id); }); }); });
  const seenOn = (art, so) => {
    const f = family(so.customer_id);
    return [art.design_id ? 'd:' + art.design_id : '', _realName(art) ? 'n:' + _nk(art) : ''].filter(Boolean)
      .some(k => [...(idx.get(f + '#' + k) || [])].some(id => id !== so.id));
  };
  const out = new Map();
  safeArr(jobs).forEach(j => {
    const so = j?.so;
    if (!so || so.status === 'complete' || _ARTIST_STAGES.includes(j.art_status) || ['completed', 'shipped'].includes(j.prod_status)) return;
    const items = safeItems(so);
    const jobArtIds = jobArtFileIds(j, items);
    safeArr(j.items).forEach(gi => {
      const it = items[gi?.item_idx];
      if (!it) return;
      jobItemArtSlots(gi, it).forEach(({ d }) => {
        if (!jobArtIds.has(d.art_file_id)) return;
        const art = safeArt(so).find(a => a?.id === d.art_file_id);
        if (!art) return;
        [[d.color_way_id || null, ''], ...(d.reversible ? [[d.color_way_id_b || null, 'B']] : [])].forEach(([cw, side]) => {
          const key = so.id + '|' + art.id + '|' + (cw || '');
          if (out.has(key) || logoDetailUrl(art, cw)) return;
          if (!libOf(so.customer_id).some(l => _sameDesign(l, art)) && !seenOn(art, so)) return;
          out.set(key, { key, so, job: j, art, colorWayId: cw, side, garmentColor: safeStr(it.color),
            label: (art.name || 'Artwork') + (cw ? ' · ' + _cwLabel(art, cw) : '') });
        });
      });
    });
  });
  return [...out.values()];
};
