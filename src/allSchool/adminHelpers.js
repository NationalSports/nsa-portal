// Defaults are opt-in for new All School stores; never applied to ordinary stores.
export const allSchoolDefaults = () => ({
  programs: [], target_ship_days: 14, show_promo_banner: false, secondary_logo_url: '',
  promo_eyebrow: 'For the whole school', promo_heading: 'Wear your pride.',
  promo_description: 'Students, families, staff, and alumni. Your school favorites belong everywhere.',
  promo_button_label: 'Shop school spirit', promo_destination: 'spirit', promo_art_text: 'School Spirit.',
  purchasing: { enabled: false, mode: 'minimum_weekly', minimum_cents: 20000, weekday: 3, time: '09:00', timezone: 'America/Los_Angeles', combine_regular: true, no_batch_policy: 'separate', max_wait_days: 7, max_run_cents: 100000 },
  shipping: { mode: 'flat', package_weight_oz: 2, length_in: 12, width_in: 10, height_in: 3, service_code: 'ups_ground', origin_code: 'OR', fallback: 'block' },
  dtf: { supplier_id: null, auto_send: false },
});
export const normalizeAllSchoolSettings = (value) => {
  const defaults = allSchoolDefaults(); const input = value || {};
  return { ...defaults, ...input, show_promo_banner: input.show_promo_banner === true, secondary_logo_url: typeof input.secondary_logo_url === 'string' ? input.secondary_logo_url : '', programs: Array.isArray(input.programs) ? input.programs : [], purchasing: { ...defaults.purchasing, ...input.purchasing }, shipping: { ...defaults.shipping, ...input.shipping }, dtf: { ...defaults.dtf, ...input.dtf } };
};
export const validateAllSchoolSettings = (value) => {
  const s = normalizeAllSchoolSettings(value);
  if (!Number.isInteger(Number(s.target_ship_days)) || Number(s.target_ship_days) < 1 || Number(s.target_ship_days) > 90) return 'Shipment target must be between 1 and 90 days.';
  const seen = new Set(); const slugs = new Set();
  for (const p of s.programs) {
    if (!p.id || !p.name?.trim() || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(p.slug || '')) return 'Each sport needs a name and a valid URL slug.';
    if (seen.has(p.id) || slugs.has(p.slug)) return 'Sports must have unique IDs and URL slugs.';
    seen.add(p.id); slugs.add(p.slug);
  }
  const p = s.purchasing;
  if (!Number.isInteger(Number(p.minimum_cents)) || Number(p.minimum_cents) < 0) return 'Purchasing minimum must be a nonnegative dollar amount.';
  if (!Number.isInteger(Number(p.max_run_cents)) || Number(p.max_run_cents) < Number(p.minimum_cents)) return 'Maximum per run must be at least the purchasing minimum.';
  if (!Number.isInteger(Number(p.max_wait_days)) || Number(p.max_wait_days) < 1 || Number(p.max_wait_days) > Number(s.target_ship_days)) return 'Maximum purchasing wait must fit within the shipment target.';
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(p.time || '') || Number(p.weekday) < 0 || Number(p.weekday) > 6) return 'Choose a valid weekly purchasing day and time.';
  for (const key of ['length_in', 'width_in', 'height_in']) if (!(Number(s.shipping[key]) > 0)) return 'Package dimensions must be greater than zero.';
  if (!(Number(s.shipping.package_weight_oz) > 0)) return 'Packaging weight must be greater than zero.';
  return '';
};
const COPY_FIELDS = ['kind', 'product_id', 'sku', 'retail_price', 'fundraise_amount', 'image_url', 'image_back_url', 'takes_number', 'takes_name', 'name_upcharge', 'transfer_codes', 'transfer_code', 'num_transfer_sets', 'num_transfer_size', 'num_transfer_color', 'decorations', 'category', 'kit_name', 'required', 'options', 'display_name', 'sizes_offered', 'active', 'deco_upcharge', 'deco_cost_estimate', 'track_inventory', 'size_sku_overrides', 'variant_label', 'personalization_template', 'weight_oz'];
export const coreOfferingCopies = (sources, programId, storeId, existing = [], groupIdFor = () => crypto.randomUUID()) => {
  const groups = new Map();
  return (sources || []).filter((row) => row.kind === 'single' && !row.school_template_id && !(row.school_program_ids || []).length && !existing.some((copy) => copy.school_template_id === row.id && (copy.school_program_ids || []).includes(programId))).map((row, i) => {
    const fields = {}; COPY_FIELDS.forEach((key) => { if (row[key] !== undefined) fields[key] = JSON.parse(JSON.stringify(row[key])); });
    const groupKey = row.variant_group_id || row.id;
    if (!groups.has(groupKey)) groups.set(groupKey, groupIdFor());
    return { ...fields, store_id: storeId, school_program_ids: [programId], school_shared: false, school_template_id: row.id, variant_group_id: groups.get(groupKey), active: row.active !== false, sort_order: existing.length + i };
  });
};

// A sport design is explicitly selected by staff. Its visual overlay references
// the same inventory code as production, so it must not become a second print.
export const applySportDesign = (rows, stock, logo) => (rows || []).map((row) => ({
  ...row,
  image_url: null, image_back_url: null,
  transfer_codes: [stock.code], transfer_code: null,
  decorations: [{ kind: 'art', art_id: logo.id, art_url: logo.url, placement: 'full_front', side: 'front', type: 'dtf', transfer_code: stock.code, baked: false }],
}));

export const stockLinkedArtError = (item, decorations) => {
  const codes = [...new Set([...(item?.transfer_codes || []), item?.transfer_code].filter(Boolean))];
  if (!codes.length || JSON.stringify(item.decorations || []) === JSON.stringify(decorations || [])) return '';
  const art = (decorations || []).filter((d) => d && !['perso_name', 'perso_number'].includes(d.kind) && (d.kind === 'art' || d.art_id || d.art_url));
  if (!art.length || art.some((d) => !codes.includes(d.transfer_code)) || codes.some((code) => !art.some((d) => d.transfer_code === code))) return 'This All School offering uses a saved decoration-stock design. Choose the exact new production design and web logo in Sports & collections, then use “Use selected sport design”. Generic logo replacement cannot change its production artwork.';
  return '';
};

export const changesProductionSetup = (fields) => ['decorations', 'transfer_codes', 'transfer_code', 'num_transfer_sets', 'num_transfer_size', 'num_transfer_color', 'takes_name', 'takes_number', 'personalization_template', 'product_id', 'sku', 'sizes_offered', 'size_sku_overrides', 'options'].some((key) => Object.prototype.hasOwnProperty.call(fields || {}, key));
