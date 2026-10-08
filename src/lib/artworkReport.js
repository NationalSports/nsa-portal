// Purchased artwork is frozen on the order; never resolve it from today's catalog.
export const recipeKey = (value) => {
  const stable = (v) => Array.isArray(v) ? v.map(stable) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, stable(v[k])])) : v;
  return value ? JSON.stringify(stable(value)) : '';
};
export function artworkInstructions(line) {
  const r = line.production_recipe || line.recipe_snapshot;
  if (!r) return '';
  const parts = (r.decorations || []).filter((d) => d.art_id || d.art_url).map((d) => {
    const art = (r.art_files || []).find((a) => a.id === d.art_id);
    const name = art?.name || r.school_design_label || d.art_id || 'Artwork';
    const placement = (d.placement || d.side || 'front').replace(/_/g, ' ');
    return `${name} — ${placement}${d.color_label ? ` — ${d.color_label}` : ''}${d.art_url ? ` — ${d.art_url}` : ''}`;
  });
  for (const t of r.transfer_inventory || []) parts.push([t.label || t.code, (t.decoration_type || '').replace(/_/g, ' '), (t.application_method || '').replace(/_/g, ' '), t.application_instructions].filter(Boolean).join(' — '));
  return [...new Set(parts)].join('; ') || r.school_design_label || '';
}
export const artworkItemName = (name, line) => {
  const detail = artworkInstructions(line);
  return detail ? `${name} [Artwork: ${detail}]` : name;
};
