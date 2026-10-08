const schoolArtwork = (arts) => [...new Set(arts.map((a) => a.id))].map((id) => { const matches = arts.filter((a) => a.id === id); return { ...Object.assign({}, ...matches.slice().reverse()), files: matches.flatMap((a) => a.files || []), prod_files: matches.flatMap((a) => a.prod_files || []) }; });
const STOCK_METHODS = ['dtf', 'heat_press', 'heat_transfer', 'twill', 'patch', 'chenille', 'embroidered_patch', 'woven_patch', 'sublimation_patch', 'screen_print_transfer'];
const stockCodeForArt = (id) => `store-art-${encodeURIComponent(String(id))}`;
function resolveSchoolSetup(item, transfers = [], art = []) {
  const codes = new Set([...(item.transfer_codes || []), item.transfer_code].filter(Boolean));
  const decorations = (item.decorations || []).map((d) => {
    if (!d || ['perso_name', 'perso_number'].includes(d.kind)) return d;
    const id = d.art_id || d.art_file_id;
    const file = schoolArtwork(art).find((a) => a.id === id);
    if (['embroidery', 'screen_print'].includes(file?.deco_type)) {
      if (d.transfer_code) codes.delete(d.transfer_code);
      const { transfer_code, ...placed } = d;
      return { ...placed, type: file.deco_type, deco_type: file.deco_type };
    }
    const stock = transfers.find((t) => t.code === (d.transfer_code || stockCodeForArt(id)));
    const method = stock?.decoration_type || file?.deco_type || d.type || d.deco_type || '';
    if (stock && STOCK_METHODS.includes(method)) {
      codes.add(stock.code);
      return { ...d, transfer_code: stock.code, type: method, deco_type: method };
    }
    return { ...d, type: method, deco_type: method };
  });
  return { ...item, decorations, transfer_codes: [...codes] };
}
function methodSetupError(raw, transfers = [], art = []) {
  const item = resolveSchoolSetup(raw, transfers, art);
  if (!item.product_id || !item.sku) return 'Link the exact blank garment and SKU.';
  if (!item.image_url) return 'Save the garment mockup in Art & colors.';
  for (const code of item.transfer_codes) {
    const stock = transfers.find((t) => t.code === code);
    if (!stock || !STOCK_METHODS.includes(stock.decoration_type || 'dtf')) return `Set up decoration inventory for ${stock?.label || code}.`;
    if (!stock.application_method) return `Choose the application method for ${stock.label || code} in Inventory.`;
  }
  for (const d of item.decorations) {
    if (!d || ['perso_name', 'perso_number'].includes(d.kind)) continue;
    if (d.transfer_code && item.transfer_codes.includes(d.transfer_code)) continue;
    const file = schoolArtwork(art).find((a) => a.id === (d.art_id || d.art_file_id));
    const method = d.type;
    if (method === 'screen_print') return 'Screen print is not offered on 24/7 stores. Choose DTF, heat-transfer twill, patch, or embroidery.';
    if (STOCK_METHODS.includes(method)) return `Set up inventory for ${file?.name || 'this logo'} in Inventory.`;
    if (method !== 'embroidery') return 'Choose a supported decoration method in Art & Logos.';
    const files = [...(file?.files || []), ...(file?.prod_files || [])];
    if (!files.some((f) => /\.dst(?:\?|$)/i.test(typeof f === 'string' ? f : f.url || '') || (f?.url && /\.dst$/i.test(f.name || '')))) return `Attach the embroidery .dst file to ${file?.name || 'this artwork'} in Art & Logos.`;
  }
  if (item.takes_name) {
    const t = item.personalization_template;
    if (!t?.font || !t?.print_color || !t?.placement || !(Number(t.width_in) > 0) || !(Number(t.height_in) > 0) || !t.production_file?.bucket || !t.production_file?.path || !/\.ai$/i.test(t.production_file.name || t.production_file.path) || !Number.isFinite(Number(t.unit_cost)) || Number(t.unit_cost) < 0) return 'Name personalization needs its exact .ai template, font, color, dimensions, placement and unit cost.';
  }
  if (item.takes_number) {
    const sets = item.num_transfer_sets?.length ? item.num_transfer_sets : item.num_transfer_size ? [`${item.num_transfer_size}|${item.num_transfer_color || ''}`] : [];
    if (!sets.length) {
      const t = item.personalization_template?.number_template;
      if (!t?.font || !t?.print_color || !t?.placement || !(Number(t.width_in) > 0) || !(Number(t.height_in) > 0) || !t.production_file?.bucket || !t.production_file?.path || !/\.ai$/i.test(t.production_file.name || t.production_file.path) || !Number.isFinite(Number(t.unit_cost)) || Number(t.unit_cost) < 0) return 'Custom numbers need their own exact .ai template, font, print color, dimensions, placement and unit cost.';
    }
    for (const set of sets) {
      const [size, color] = set.split('|');
      for (let digit = 0; digit <= 9; digit++) {
        const matches = transfers.filter((t) => t.kind === 'number' && String(t.digit) === String(digit) && (t.tsize || t.size || '') === size && (t.color || '') === color);
        if (matches.length !== 1) return `Number set ${set} needs one exact stock record for digit ${digit}.`;
        const t = matches[0];
        if ((t.decoration_type || 'dtf') === 'dtf' && (!t.production_file?.bucket || !t.production_file?.path || !/\.ai$/i.test(t.production_file.name || t.production_file.path) || !(Number(t.width_in) > 0) || !(Number(t.height_in) > 0))) return `DTF digit ${digit} in ${set} needs its exact .ai file and dimensions in Inventory.`;
      }
    }
  }
  return '';
}
module.exports = { schoolArtwork, STOCK_METHODS, resolveSchoolSetup, methodSetupError };
