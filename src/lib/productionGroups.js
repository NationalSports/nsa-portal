import { safeArr, safeStr, jobItemArtSlots, jobItemDecosOfKind } from '../safeHelpers';
import { resolveLogoColorWay } from './logoDetail';

// ── Production decoration groups ──
// Garment lines on one job that get the SAME decoration (same design, same ink color way,
// same placement, same numbers/names/twill setup) are produced as one run, so the production
// view and the printed job sheet show them together instead of one SKU at a time.
//
// The key mirrors what actually prints: a decoration with no explicit color way resolves it
// from the garment color the same way the logo detail does (resolveLogoColorWay), so two lines
// can never merge when they would print in different inks. A color way that can't be resolved
// keys on the garment color instead — ambiguous garments never merge with each other.
// Garment color alone does NOT split a group (same inks on a navy and a white tee run together);
// the display shows a logo preview per garment color.

const _norm = v => safeStr(v).trim().toLowerCase();

const _cwKey = (art, cwId, color, side) => {
  if (cwId) return 'cw:' + cwId;
  const r = resolveLogoColorWay(art, null, color, side);
  if (r === null) return 'cw:-';
  if (r === undefined) return 'garment:' + _norm(safeStr(color).split('/')[side === 'B' ? 1 : 0]);
  return 'cw:' + r;
};

const _personalKey = (d, kind) => [
  kind, _norm(d.position), _norm(d.print_color), d.reversible ? _norm(d.print_color_b) : '',
  _norm(kind === 'numbers' ? d.num_method : d.name_method), _norm(d.num_size), _norm(d.num_size_back),
  d.front_and_back ? 'fb' : '', d.reversible ? 'rev' : '',
].join('~');

/** Decoration fingerprint of one job row (gi) on its SO line (it). */
export const productionDecoKey = (gi, it, artFiles) => {
  if (!it) return 'missing:' + safeStr(gi?.item_idx);
  const arts = safeArr(artFiles);
  const parts = jobItemArtSlots(gi, it).map(({ d }) => {
    const a = arts.find(x => x?.id === d.art_file_id);
    return ['art', d.art_file_id, _norm(d.position), _cwKey(a, d.color_way_id, it.color || gi.color, d.reversible ? 'A' : ''),
      d.reversible ? _cwKey(a, d.color_way_id_b, it.color || gi.color, 'B') : '',
      d.underbase ? 'ub' : '', d.reversible ? 'rev' : ''].join('~');
  });
  jobItemDecosOfKind(gi, it, 'numbers').forEach(d => parts.push(_personalKey(d, 'numbers')));
  jobItemDecosOfKind(gi, it, 'names').forEach(d => parts.push(_personalKey(d, 'names')));
  jobItemDecosOfKind(gi, it, 'twill').forEach(d => parts.push(['twill', _norm(d.position), safeStr(d.dtf_size), d.reversible ? 'rev' : ''].join('~')));
  return parts.sort().join('|') || 'blank';
};

/**
 * Groups rows by key, keeping first-appearance order for groups and job order within each.
 * Returns [{ key, items }].
 */
export const groupByDecoration = (rows, keyOf) => {
  const groups = [];
  const byKey = new Map();
  safeArr(rows).forEach(row => {
    const key = keyOf(row);
    let g = byKey.get(key);
    if (!g) { g = { key, items: [] }; byKey.set(key, g); groups.push(g); }
    g.items.push(row);
  });
  return groups;
};

/** Human label for a job row's decoration, e.g. "Front: Crest (Navy) + Numbers · Back". */
export const productionDecoSummary = (gi, it, artFiles) => {
  if (!it) return '';
  const arts = safeArr(artFiles);
  const pos = d => (d.position ? ' · ' + d.position : '');
  return [
    ...jobItemDecosOfKind(gi, it, 'art').map(d => {
      const a = arts.find(x => x?.id === d.art_file_id);
      const cw = d.color_way_id ? safeArr(a?.color_ways).find(c => c?.id === d.color_way_id) : null;
      const cwName = cw ? (cw.name || cw.label || cw.garment_color || '') : '';
      return (d.position ? d.position + ': ' : '') + (a?.name || 'Artwork') + (cwName ? ' (' + cwName + ')' : '');
    }),
    ...jobItemDecosOfKind(gi, it, 'numbers').map(d => 'Numbers' + pos(d)),
    ...jobItemDecosOfKind(gi, it, 'names').map(d => 'Names' + pos(d)),
    ...jobItemDecosOfKind(gi, it, 'twill').map(d => 'Tackle twill' + pos(d)),
  ].join(' + ');
};
