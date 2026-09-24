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
