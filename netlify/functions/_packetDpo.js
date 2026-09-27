const { jsPDF } = require('jspdf');
const list = value => Array.isArray(value) ? value : [];
const clean = value => String(value || '').trim();
const fail = (status, message) => { const error = new Error(message); error.status = status; throw error; };
const quantity = sizes => Object.entries(sizes || {}).reduce((sum, [size, value]) => /^(drop_ship|unit_cost|_)/i.test(size) ? sum : sum + Math.max(0, Number(value) || 0), 0);
const isActive = dp => dp && dp.po_id && !['cancelled', 'canceled', 'void'].includes(String(dp.status || '').toLowerCase());
const isActiveSo = so => !['cancelled', 'canceled', 'void'].includes(String(so.status || '').toLowerCase());
const same = (a, b) => clean(a).toLowerCase() === clean(b).toLowerCase();
const belongsToDpo = (decoration, dp, item) => {
  if (!decoration) return false;
  const direct = clean(decoration.deco_po_id);
  if (direct) return direct === clean(dp.id) || direct === clean(dp.po_id);
  if (decoration.fulfillment !== 'outside' && decoration.kind !== 'outside_deco') return false;
  const vendor = clean(decoration.vendor);
  if (vendor && dp.vendor && !same(vendor, dp.vendor)) return false;
  const method = clean(decoration.deco_type || decoration.type);
  if (method && dp.deco_type && !same(method, dp.deco_type)) return false;
  // An item may be assigned to several decorators. Without a vendor, type, or
  // explicit PO reference, we cannot identify which decoration belongs here.
  if (!vendor && !method && !direct && (item.decorations || []).length > 1) return false;
  return true;
};
const pageAll = async makeQuery => {
  const rows = [];
  for (let start = 0; ; start += 500) {
    const { data, error } = await makeQuery().range(start, start + 499);
    if (error) throw new Error(error.message);
    rows.push(...(data || []));
    if (!data || data.length < 500) return rows;
    if (rows.length >= 50000) fail(413, 'Too many DPO records for one packet');
  }
};
function resolveDpos(orders, decorators, vendors) {
  return orders.filter(isActiveSo).flatMap(so => list(so.deco_pos).filter(isActive).map(dp => {
    const decorator = decorators.find(d => d.id === dp.deco_vendor_id) || decorators.find(d => d.name === dp.vendor);
    const vendor = vendors.find(v => v.id === decorator?.vendor_id);
    return { id: dp.id || dp.po_id, soId: so.id, number: dp.po_id, vendor: dp.vendor || decorator?.name || vendor?.name || '',
      email: clean(dp.contact_email || dp.email || vendor?.contact_email), dueDate: dp.expected_date || null,
      status: dp.status || 'waiting', savedQuantity: Number.isFinite(Number(dp.qty)) ? Number(dp.qty) : null,
      notes: clean(dp.notes), dp, so };
  }));
}
async function dpoInventory(ctx) {
  if (ctx._dpoInventory) return ctx._dpoInventory;
  ctx._dpoInventory = (async () => {
  const orders = await pageAll(() => ctx.admin.from('sales_orders').select('id,webstore_id,status,deco_pos').eq('webstore_id', ctx.storeId).order('id'));
  const scopedOrders = orders.filter(so => isActiveSo(so) && (!ctx.soId || so.id === ctx.soId));
  const [decorators, vendors] = await Promise.all([
    pageAll(() => ctx.admin.from('deco_vendors').select('id,name,vendor_id').order('id')),
    pageAll(() => ctx.admin.from('vendors').select('id,name,contact_email').order('id')),
  ]);
  const entries = resolveDpos(scopedOrders, decorators, vendors);
  const soIds = [...new Set(entries.map(e => e.soId))];
  const allItems = [];
  for (let start = 0; start < soIds.length; start += 100) allItems.push(...await pageAll(() => ctx.admin.from('so_items').select('id,line_id,so_id,item_index,sku,name,color,sizes').in('so_id', soIds.slice(start, start + 100)).order('item_index')));
  const indexedItems = Object.fromEntries(soIds.map(id => [id, allItems.filter(item => item.so_id === id)]));
  const summaries = entries.map(({ dp, so, ...entry }) => {
    const assigned = new Set(list(dp.item_idxs).map(Number).filter(Number.isInteger));
    const coveredQuantity = list(indexedItems[entry.soId]).reduce((sum, item, index) => sum + (assigned.has(Number(item.item_index == null ? index : item.item_index)) ? quantity(item.sizes) : 0), 0);
    return { ...entry, coveredQuantity, discrepancy: entry.savedQuantity == null || entry.savedQuantity === coveredQuantity ? null : { saved: entry.savedQuantity, covered: coveredQuantity } };
  });
  return { entries, indexedItems, summaries };
  })();
  return ctx._dpoInventory;
}
// DPO is a view context over an existing recipient grant. The stored token's
// store and SO remain authoritative; URL/body parameters cannot enlarge them.
async function attachDpoContext(ctx, packet, body = {}) {
  const dpoId = clean(body.dpo_id), dpoSoId = clean(body.dpo_so_id);
  if (!!dpoId !== !!dpoSoId) fail(400, 'Choose both a DPO and its sales order');
  if (dpoId && body.revision_id) fail(400, 'Open the issued full packet to view its frozen production details');
  if (dpoSoId && ctx.soId && dpoSoId !== ctx.soId) fail(403, 'DPO is outside this recipient link');
  const { entries, indexedItems, summaries } = await dpoInventory(ctx);
  if (!dpoId) return packet ? { ...packet, dpos: summaries } : { dpos: summaries };
  const entry = entries.find(e => e.id === dpoId && e.soId === dpoSoId);
  if (!entry) fail(404, 'DPO is no longer available in this recipient link');
  const items = indexedItems[dpoSoId] || [];
  const coveredIndexes = new Set(list(entry.dp.item_idxs).map(Number).filter(Number.isInteger));
  const coveredItems = items.filter((item, index) => coveredIndexes.has(Number(item.item_index == null ? index : item.item_index)));
  if (!ctx._dpoDecorations) ctx._dpoDecorations = new Map();
  const decoCacheKey = `${dpoSoId}:${coveredItems.map(i => i.id).join(',')}`;
  if (!ctx._dpoDecorations.has(decoCacheKey)) ctx._dpoDecorations.set(decoCacheKey, coveredItems.length ? pageAll(() => ctx.admin.from('so_item_decorations').select('id,so_item_id,deco_index,kind,fulfillment,deco_po_id,vendor,deco_type,type').in('so_item_id', coveredItems.map(i => i.id)).order('id')) : Promise.resolve([]));
  const decos = await ctx._dpoDecorations.get(decoCacheKey);
  const garmentIds = new Set(), decorationIds = new Set();
  const warnings = [], blockingWarnings = [];
  const warnAssignment = value => { warnings.push(value); blockingWarnings.push(value); };
  coveredItems.forEach(item => {
    const sourcePosition = items.indexOf(item);
    if (item.item_index == null) warnings.push(`${item.sku || 'Covered item'}: SO item position is missing; confirm this DPO coverage against the saved order.`);
    const garmentId = `${dpoSoId}:${item.line_id || item.id || sourcePosition}`;
    garmentIds.add(garmentId);
    garmentIds.add(`garment:${item.id}`);
    const itemDecos = decos.filter(d => d.so_item_id === item.id).sort((a, b) => a.deco_index - b.deco_index);
    const itemIndex = Number(item.item_index == null ? sourcePosition : item.item_index);
    const matched = itemDecos.filter(d => {
      if (!belongsToDpo(d, entry.dp, { decorations: itemDecos })) return false;
      if (clean(d.deco_po_id)) return true;
      const candidates = entries.filter(candidate => candidate.soId === dpoSoId && list(candidate.dp.item_idxs).map(Number).includes(itemIndex) && belongsToDpo(d, candidate.dp, { decorations: itemDecos }));
      if (candidates.length > 1) {
        warnAssignment(`${item.sku || 'Covered item'}: a decoration could belong to multiple DPOs, so it was omitted until the PO assignment is explicit.`);
        return false;
      }
      return true;
    });
    if (!matched.length) warnAssignment(`${item.sku || 'Covered item'}: no decoration assignment can be confirmed for this DPO. Review the PO and line routing.`);
    itemDecos.forEach((d, di) => { if (matched.includes(d)) {
      decorationIds.add(`${garmentId}:deco:${di}`);
      decorationIds.add(`decoration:${d.id}`);
    } });
  });
  const coveredQuantity = coveredItems.reduce((sum, item) => sum + quantity(item.sizes), 0);
  const discrepancy = entry.savedQuantity == null || entry.savedQuantity === coveredQuantity ? null : { saved: entry.savedQuantity, covered: coveredQuantity };
  if (!coveredItems.length) warnAssignment('No SO garment lines are assigned to this DPO. Review its item selection.');
  if (discrepancy) warnings.push(`DPO saved quantity ${discrepancy.saved} differs from covered SO garment quantity ${discrepancy.covered}; the DPO may count applications rather than garments.`);
  const dpo = { ...summaries.find(e => e.id === dpoId && e.soId === dpoSoId), expectedDate: entry.dp.expected_date || null, coveredQuantity, coveredItems: coveredItems.map(item => ({ sku: item.sku, name: item.name, color: item.color, sizes: item.sizes, quantity: quantity(item.sizes) })), discrepancy, warnings };
  if (!packet) return { dpo, dpos: summaries };
  const legacySnapshot = list(packet.garments).some(g => g.soId === dpoSoId && !String(g.id).startsWith('garment:') && !Array.isArray(g.legacyIds));
  if (legacySnapshot) warnings.push('This issued packet uses older position-based item references. Verify DPO assignments against the current sales order.');
  const decorations = list(packet.decorations).filter(d => decorationIds.has(d.id) && (!legacySnapshot || String(d.id).startsWith('decoration:')));
  const includedDecorations = new Set(decorations.map(d => d.id));
  const garments = list(packet.garments).filter(g => garmentIds.has(g.id) && coveredItems.some(item => item.sku === g.sku && item.color === g.color)).map(g => ({ ...g, decorationIds: list(g.decorationIds).filter(id => includedDecorations.has(id)) }));
  const selectedSkus = new Set(garments.map(g => `${g.sku}\u0000${g.color}`));
  const ambiguousPlayerKeys = new Set(list(packet.garments).filter(g => g.soId === dpoSoId && selectedSkus.has(`${g.sku}\u0000${g.color}`) && !garments.some(selected => selected.id === g.id)).map(g => `${g.sku}\u0000${g.color}`));
  if (ambiguousPlayerKeys.size) warnings.push('Player rows sharing a SKU and color with other SO garments were omitted because their DPO assignment cannot be verified.');
  const players = list(packet.players).filter(p => p.soId === dpoSoId && selectedSkus.has(`${p.sku}\u0000${p.color}`) && !ambiguousPlayerKeys.has(`${p.sku}\u0000${p.color}`));
  const targets = new Set([...garments, ...decorations, ...players].flatMap(r => [r.id, ...list(r.legacyIds)]));
  const notes = list(packet.notes).filter(n => (!n.soId || n.soId === dpoSoId) && (!n.targetId || targets.has(n.targetId)));
  const messages = list(packet.messages).filter(m => m.soId === dpoSoId && (!m.metadata?.dpoId || m.metadata.dpoId === dpoId) && (!m.targetId || targets.has(m.targetId)));
  const messageIds = new Set(messages.map(m => m.id));
  const skus = new Set(garments.map(g => g.sku).filter(Boolean));
  const sourceIssues = list(packet.issueDetails);
  const scopedIssues = sourceIssues.length ? sourceIssues.filter(issue => issue.soId === dpoSoId && (
    issue.section === 'messages' ? messageIds.has(issue.targetId) : !issue.targetId || targets.has(issue.targetId)
  )) : list(packet.issues).filter(issue => typeof issue === 'string' && issue.includes(dpoSoId)).map((text, index) => ({ id: `legacy-issue:${index}`, text, section: 'garments', targetId: null, soId: dpoSoId }));
  const issues = [...scopedIssues.map(issue => issue.text), ...blockingWarnings];
  const issueDetails = [...scopedIssues, ...blockingWarnings.map((text, index) => ({ id: `dpo-warning:${index}`, text, section: 'garments', targetId: null, soId: dpoSoId }))];
  const changes = packet.changes && { ...packet.changes,
    substitutions: list(packet.changes.substitutions).filter(c => c.soId === dpoSoId && skus.has(c.from || c.sku)),
    sizeChanges: list(packet.changes.sizeChanges).filter(c => c.soId === dpoSoId && skus.has(c.sku)),
  };
  return { ...packet, dpo, dpos: summaries, soId: dpoSoId,
    salesOrders: list(packet.salesOrders).filter(so => so.id === dpoSoId), garments, decorations, players, notes, messages, issues, issueDetails, ready: !issues.length, changes,
    totals: { ...packet.totals, garments: garments.reduce((sum, g) => sum + (Number(g.units) || 0), 0), playerUnits: players.reduce((sum, p) => sum + (Number(p.qty) || 0), 0), unbatchedUnits: 0,
      orders: new Set(players.filter(p => !p.extra).map(p => p.orderKey)).size, players: new Set(players.filter(p => !p.extra).map(p => `${p.orderId}:${p.player}`)).size },
  };
}
// A dated copy of the selected DPO, built from its saved terms and covered SO lines.
async function dpoPdf(entry) {
  const doc = new jsPDF({unit:'pt',format:'letter'});
  let y = 48;
  const room = height => {if(y + height > 740){doc.addPage();y=48;}};
  const line = (value, strong=false, size=11) => {
    doc.setFont('helvetica',strong?'bold':'normal');doc.setFontSize(size);doc.setTextColor(20,46,59);
    const text = String(value ?? '').replace(/[^\x20-\x7e\n]/g, ' ');
    const rows = doc.splitTextToSize(text,510);
    for(const row of rows) { if(y > 740){doc.addPage();y=48;} doc.text(row,48,y);y+=size+6; }
  };
  const {dp,so} = entry;
  line('NATIONAL SPORTS APPAREL',true,12);
  line('DECORATION PURCHASE ORDER',true,18);
  line(entry.number,true,15);
  line(`${entry.vendor} | ${so.id}`);
  line(`Status: ${dp.status || 'Waiting'} | Expected return: ${dp.expected_date || 'Not specified'}`);
  line(`Saved DPO quantity: ${dp.qty ?? 'Not specified'} | Unit cost: $${Number(dp.unit_cost || 0).toFixed(2)}`);
  line(`Expected cost: $${Number(dp.expected_cost ?? Number(dp.qty || 0)*Number(dp.unit_cost || 0)).toFixed(2)}`);
  line(`Reference generated: ${new Date().toISOString()}`);
  y += 12;
  line('ITEMS ON THIS DPO',true,13);
  const covered = list(dp.item_idxs).map(index => list(so.items).find((it, position) => Number(it.item_index == null ? position : it.item_index) === Number(index))).filter(Boolean);
  const coveredQuantity = covered.reduce((sum, it) => sum + quantity(it.sizes), 0);
  line(`Covered SO item quantity: ${coveredQuantity}`);
  if (dp.qty != null && Number(dp.qty) !== coveredQuantity) line(`Quantity review: saved DPO quantity ${dp.qty} differs from covered SO quantity ${coveredQuantity}.`);
  for (const it of covered) {
    room(80);
    line(`${it.sku || ''} - ${it.name || ''} - ${it.color || ''}`,true);
    line(Object.entries(it.sizes || {}).map(([size,qty]) => `${size}: ${qty}`).join(' | '));
    const rate = dp.item_costs?.[it.item_index] ?? dp.unit_cost;
    if (rate != null) line(`Decoration rate: $${Number(rate).toFixed(2)}`);
    y += 6;
  }
  if (!covered.length) line('No garment lines are assigned to this DPO.');
  room(90);
  line('DPO NOTES',true,13); line(dp.notes || 'No notes saved on this DPO.');
  line('Use the linked production packet for current artwork, mocks, player details and shared instructions.');
  return Buffer.from(doc.output('arraybuffer')).toString('base64');
}
module.exports = { resolveDpos, attachDpoContext, dpoPdf };
