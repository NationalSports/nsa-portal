// Catalog navigation groups logo alternatives, while each editor keeps its own colors.
export function catalogGroups(catalog, school = false, firstLogoByStyle = {}) {
  const designs = new Map();
  [...catalog].sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0)).forEach((row) => {
    const key = row.variant_group_id || row.id;
    if (!designs.has(key)) designs.set(key, { key, rep: row, rows: [] });
    designs.get(key).rows.push(row);
  });
  const listings = new Map();
  for (const design of designs.values()) {
    const row = design.rep;
    const key = school && row.kind === 'single' && row.school_style_group_id
      ? `${row.school_style_group_id}|${[...(row.school_program_ids || [])].sort().join(',')}` : design.key;
    if (!listings.has(key)) listings.set(key, []);
    listings.get(key).push(design);
  }
  return [...listings].map(([key, options]) => {
    const preferred = firstLogoByStyle[options[0].rep.school_style_group_id];
    const main = options.find((g) => g.key === preferred && g.rep.active !== false)
      || options.find((g) => g.rep.active !== false) || options[0];
    return { ...main, key, designs: options, allRows: options.flatMap((g) => g.rows) };
  });
}

export function catalogEditorRows(groups, id) {
  return groups.flatMap((group) => group.designs).find((design) => design.rows.some((row) => row.id === id))?.rows || [];
}
