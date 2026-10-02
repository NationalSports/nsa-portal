import { placementById } from '../lib/artPlacements';

const text = value => value == null ? '' : String(value);
const arr = value => Array.isArray(value) ? value : [];
const bounded = (value, fallback) => Number.isFinite(Number(value)) ? Math.max(0, Math.min(100, Number(value))) : fallback;
const stable = value => JSON.stringify(value, (key, v) => v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v);

// Explicit decorator-safe projection. Never expose raw recipes, purchasing costs,
// supplier contacts, approval actor IDs or private storage paths.
export function frozenPurchasedMocks(item, lines, safeUrl) {
  const recipe = item.recipe_snapshot;
  if (!recipe || recipe.version !== 1) return [];
  const ids = new Set(arr(item.source_webstore_item_ids).map(String));
  const bought = lines.filter(line => ids.has(String(line.id)) && !line.is_bundle_parent);
  const decorations = arr(recipe.decorations).filter(Boolean).map(d => {
    const pl = placementById(d.placement);
    return { kind: text(d.kind), side: d.side === 'back' ? 'back' : 'front', placement: text(d.placement), baked: d.baked === true, art_url: safeUrl((typeof d.cw_by_color?.[text(recipe.color).trim().toLowerCase()] === 'string' ? d.cw_by_color[text(recipe.color).trim().toLowerCase()] : d.cw_by_color?.[text(recipe.color).trim().toLowerCase()]?.url) || d.art_url), x: bounded(d.x ?? pl.x, pl.x), y: bounded(d.y ?? pl.y, pl.y), w: bounded(d.w ?? pl.w, pl.w) };
  });
  const template = recipe.personalization_template || {};
  const projectTemplate = t => ({font:text(t.font),printColor:text(t.print_color),placement:text(t.placement),widthIn:text(t.width_in),heightIn:text(t.height_in)});
  const imageFront = safeUrl(recipe.image_url), imageBack = safeUrl(recipe.image_back_url);
  return bought.map(line => ({
    id: `purchased:${text(line.id)}`, sourceLineId: text(line.id), recipeVersion: recipe.version,
    size: text(line.size), qty: Math.max(0, Number(line.qty) || 0), color: text(recipe.color),
    name: recipe.takes_name ? text(line.player_name) : '', number: recipe.takes_number ? text(line.player_number) : '',
    imageFront, imageBack, decorations,
    approved: recipe.mock_approval?.approved === true && !!imageFront && stable(line.production_recipe) === stable(recipe),
    approvedAt: text(recipe.mock_approval?.approved_at),
    template: projectTemplate(template), numberTemplate: projectTemplate(template.number_template || template),
    artworkVersions: arr(recipe.transfer_inventory).map(t => ({ code: text(t.code), version: text(t.artwork_version) })).filter(t => t.code && t.version),
  }));
}
