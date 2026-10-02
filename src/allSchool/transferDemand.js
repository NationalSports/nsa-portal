const config = (c) => ({
    codes: c.transfer_codes?.length ? c.transfer_codes : c.transfer_code ? [c.transfer_code] : [],
    takesNumber: !!c.takes_number,
    sets: c.num_transfer_sets?.length ? c.num_transfer_sets.map((s) => { const [size, color] = s.split('|'); return { size, color }; }) : c.num_transfer_size ? [{ size: c.num_transfer_size, color: c.num_transfer_color }] : [],
  });

// A blank product can have different sport logos. Only exact offering IDs may
// distinguish those; legacy product-only fallback is safe if all configs agree.
export function buildTransferMaps(catalog, bundleItems) {
  const byWp = {}, candidates = {};
  (catalog || []).forEach((c) => {
    if (c.id) byWp[c.id] = config(c);
    if (c.product_id) (candidates[c.product_id] = candidates[c.product_id] || []).push(config(c));
  });
  (bundleItems || []).forEach((c) => {
    // Linked bundle components must use the offering's authoritative config.
    if (c.webstore_product_id && byWp[c.webstore_product_id]) return;
    if (c.product_id) (candidates[c.product_id] = candidates[c.product_id] || []).push(config(c));
  });
  const byPid = {}; const ambiguousPids = [];
  Object.entries(candidates).forEach(([pid, configs]) => {
    const signature = JSON.stringify(configs[0]);
    if (configs.every((c) => JSON.stringify(c) === signature)) byPid[pid] = configs[0];
    else ambiguousPids.push(pid);
  });
  return { byWp, byPid, ambiguousPids };
}
export function transferUsage(lines, maps) {
  const used = {};
  (lines || []).forEach((line) => {
    if (line.is_bundle_parent || ['cancelled', 'refunded'].includes(line.line_status)) return;
    const units = Math.max(0, (Number(line.qty) || 0) - (Number(line.cancelled_qty) || 0) - (Number(line.refunded_qty) || 0));
    if (!units) return;
    const wpId = line.webstore_product_id || line.bundle_webstore_product_id;
    // Unknown explicit IDs must not silently select another offering by blank ID.
    const cfg = line.production_recipe?.version ? config(line.production_recipe) : wpId ? maps.byWp[wpId] : maps.byPid[line.product_id];
    if (!cfg) return;
    cfg.codes.forEach((code) => { used[code] = (used[code] || 0) + units; });
    if (cfg.takesNumber && line.player_number != null) cfg.sets.forEach((set) => {
      String(line.player_number).replace(/[^0-9]/g, '').split('').forEach((digit) => {
        const code = `${digit}|${set.size || ''}|${set.color || ''}`;
        used[code] = (used[code] || 0) + units;
      });
    });
  });
  return used;
}
export const unresolvedTransferLines = (lines, maps) => (lines || []).filter((line) => !line.is_bundle_parent && !['cancelled', 'refunded'].includes(line.line_status) && Number(line.qty) > 0 && !line.production_recipe?.version && ((line.webstore_product_id || line.bundle_webstore_product_id) ? !maps.byWp[line.webstore_product_id || line.bundle_webstore_product_id] : maps.ambiguousPids.includes(line.product_id)));
