import { safeArr, safeArt, safeItems, safeStr, jobItemArtSlots, jobArtFileIds } from '../safeHelpers';
import { pickCwAsset } from '../businessLogic';
import { knownGarmentHex } from './artGrid';

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

// Background behind the transparent logo: the garment's main color ("Light Blue/White" → light
// blue). A line whose color isn't a real color name ("CUSTOM", blank) falls back to the color way's
// garment color, then to a neutral mid grey that keeps white AND dark inks readable.
export const UNKNOWN_GARMENT_BG = '#94a3b8';
const _knownBg = (color) => {
  const main = safeStr(color).split('/')[0].trim();
  return (main && knownGarmentHex(main)) || (safeStr(color).trim() ? knownGarmentHex(color) : null);
};
export const logoDetailBackground = (color, cwColor) => {
  const k = _knownBg(color);
  if (k) return { bg: k, label: safeStr(color).trim(), known: true };
  const c = _knownBg(cwColor);
  if (c) return { bg: c, label: safeStr(cwColor).trim(), known: true };
  return { bg: UNKNOWN_GARMENT_BG, label: '', known: false };
};
export const logoDetailBg = (color, cwColor) => logoDetailBackground(color, cwColor).bg;
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
    return { ...a, web_logos: [...keep, entry], ...(colorWayId ? {} : { web_logo_url: url }) };
  });
};

// Remove one logo detail image (by url) from a design.
export const removeLogoDetail = (arts, artId, url) => safeArr(arts).map(a => {
  if (!a || a.id !== artId || !url) return a;
  return { ...a, web_logos: safeArr(a.web_logos).filter(w => w && w.url !== url), ...(a.web_logo_url === url ? { web_logo_url: '' } : {}) };
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
// deduped by image. [{ url, artName, cwLabel }]
export const garmentLogoDetails = (gi, so, artFiles) => {
  const line = safeItems(so)[gi?.item_idx];
  if (!line) return [];
  const seen = new Set();
  const out = [];
  jobItemArtSlots(gi, line).forEach(({ d }) => {
    const a = safeArr(artFiles).find(x => x?.id === d.art_file_id);
    if (!a) return;
    [d.color_way_id || null, ...(d.reversible ? [d.color_way_id_b || null] : [])].forEach(cw => {
      const url = logoDetailUrl(a, cw);
      if (!url || seen.has(url)) return;
      seen.add(url);
      const cwObj = cw ? safeArr(a.color_ways).find(c => c && c.id === cw) : null;
      out.push({ url, artName: a.name || 'Artwork', cwLabel: safeStr(cwObj?.garment_color).trim() });
    });
  });
  return out;
};
