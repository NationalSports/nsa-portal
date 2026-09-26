import { prevArtDedupKey } from './artIdentity';

const SPORTS = [
  ['Basketball', /\b(?:basketball|bball|m\s?bb|w\s?bb)\b/i],
  ['Volleyball', /\b(?:volleyball|vball|m\s?vb|w\s?vb|vb)\b/i],
  ['Football', /\b(?:football|flag football)\b/i],
  ['Baseball', /\bbaseball\b/i],
  ['Softball', /\bsoftball\b/i],
  ['Soccer', /\bsoccer\b/i],
  ['Lacrosse', /\blacrosse\b/i],
  ['Wrestling', /\bwrestling\b/i],
  ['Field Hockey', /\bfield hockey\b/i],
  ['Track & Field', /\b(?:track|field|t&f)\b/i],
  ['Cross Country', /\b(?:cross country|xc)\b/i],
  ['Tennis', /\btennis\b/i],
  ['Golf', /\bgolf\b/i],
  ['Swimming', /\b(?:swimming|swim)\b/i],
  ['Water Polo', /\bwater polo\b/i],
  ['Cheer', /\bcheer(?:leading)?\b/i],
  ['Dance', /\bdance\b/i],
  ['Hockey', /\bhockey\b/i],
];

const sportIn = label => SPORTS.find(([, pattern]) => pattern.test(label || ''))?.[0];

export function previousArtSport(customer, parentId, art, orderMemo) {
  if (!customer) return sportIn(art?.name) || sportIn(orderMemo) || 'Unspecified';
  if (customer.id === parentId) return sportIn(art?.name) || sportIn(orderMemo) || 'Program / shared';
  if (customer.sport || customer.sport_name) return String(customer.sport || customer.sport_name).trim();
  const label = [customer.name, customer.alpha_tag].filter(Boolean).join(' ');
  return sportIn(label) || sportIn(art?.name) || sportIn(orderMemo) || 'Other / unspecified';
}

// A parent-library copy and a team's order copy may be the same design. Copies
// from two sibling sports remain separate even when their art names match.
export function previousArtSourceKey(art, customerId, sport) {
  return String(customerId || 'unknown') + '|' + String(sport || 'Unspecified') + '|' + prevArtDedupKey(art);
}

export function previousArtReuseDesignId(art, customerId) {
  return art?.design_id || 'reuse:' + String(customerId || 'unknown') + ':' + String(art?.id || 'unknown');
}

export function filterPreviousArt(arts, { search = '', sport = 'all', deco = 'all' } = {}) {
  const words = String(search).trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return (arts || []).filter(art => {
    if (sport !== 'all' && art._sport !== sport) return false;
    const category = art.deco_type === 'screen_print' ? 'screen_print' : art.deco_type === 'embroidery' ? 'embroidery' : 'heat_transfer';
    if (deco !== 'all' && category !== deco) return false;
    const haystack = [art.name, art._srcTeam].filter(Boolean).join(' ').toLocaleLowerCase();
    return words.every(word => haystack.includes(word));
  });
}
