import { resolveWebstoreReportLines, reportBlockingIssues } from '../lib/soPlayerReport';
import { resolveSizeSkuSource } from '../lib/sizeSkuOverrides';
import { placementById } from '../lib/artPlacements';
import { isServiceLine } from '../constants';
import { garmentMockKey, mockSlotKeys, slotMockFiles } from '../safeHelpers';

const arr = v => Array.isArray(v) ? v : [];
const text = v => v == null ? '' : String(v);
const qty = v => Math.max(0, Number(v) || 0);
export const total = sizes => Object.values(sizes || {}).reduce((n, v) => n + qty(v), 0);
export function safeUrl(value) {
  try { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password ? u.href : ''; } catch { return ''; }
}
const files = values => arr(values).map(f => ({ url: safeUrl(typeof f === 'string' ? f : f?.url), name: text(f?.name || 'Production file') })).filter(f => f.url);
const sizeMap = value => Object.fromEntries(Object.entries(value || {}).filter(([s, n]) => !/^(drop_ship|unit_cost|_)/i.test(s) && qty(n) > 0).map(([s, n]) => [s, qty(n)]));

// Explicit projection: never return raw SO/order/art rows, pricing, private notes,
// buyer contacts, addresses, or the unshared SO conversation to a decorator.
export function buildProductionPacket({ store, orders = [], lines = [], salesOrders = [], catalog = [], notes = [], messages = [], soId = null }) {
  const includedSos = salesOrders.filter(s => s.webstore_id === store.id && (!soId || s.id === soId));
  const sos = Object.fromEntries(includedSos.map(s => [s.id, s]));
  const scopedOrders = orders.filter(o => !soId || o.so_id === soId || orders.find(p => p.id === o.backorder_of)?.so_id === soId);
  const orderIds = new Set(scopedOrders.map(o => o.id));
  const skuMaps = Object.fromEntries(catalog.filter(c => c.product_id).map(c => [c.product_id, c.size_skus || {}]));
  const sourceLines = lines.filter(l => orderIds.has(l.order_id)).map(l => {
    const source = resolveSizeSkuSource({ raw: skuMaps[l.product_id]?.[l.size || 'OS'], lineSku: l.sku, lineColor: l.color, baseProduct: { id: l.product_id, sku: l.sku, color: l.color }, candidates: [] });
    return { ...l, _effSku: source.isOverride ? source.sku : l.sku };
  });
  const reconciled = resolveWebstoreReportLines({ orders: scopedOrders, lines: sourceLines, soItemsBySo: Object.fromEntries(includedSos.map(s => [s.id, s.items])), soMetaBySo: sos });
  const issues = reportBlockingIssues(reconciled.audit);
  const garments = [], decorations = [];
  includedSos.forEach(so => {
    const seen = new Set();
    arr(so.items).forEach((item, index) => {
      const id = `${so.id}:${item.line_id || item.id || index}`;
      if (item.item_index != null && seen.has(item.item_index)) issues.push(`${so.id}: duplicate item position ${item.item_index}; repair before issuing`);
      seen.add(item.item_index);
      if (isServiceLine(item)) return;
      const sizes = sizeMap(item.sizes), units = total(sizes);
      if (item.qty_only && qty(item.est_qty) && !units) issues.push(`${so.id} ${item.sku}: quantity-only garment needs a size allocation`);
      if (!units) return;
      const decos = arr(item.decorations);
      const slots = mockSlotKeys(garmentMockKey(item), decos).map(slot => ({ ...slot, artFile: arr(so.art_files).find(a => a.id === (decos[slot.di]?.art_file_id || arr(so.jobs).find(j=>arr(j.items).some(ji=>ji.item_idx===(item.item_index ?? index) && (!Array.isArray(ji.deco_idxs)||ji.deco_idxs.includes(slot.di))))?.art_file_id) && !a.archived) }));
      const garment = { id, soId: so.id, sku: text(item.sku), name: text(item.name || item.custom_desc || item.sku), color: text(item.color), sizes, units, image: safeUrl(item.image_front_url), decorationIds: [], undecorated: !!item.no_deco };
      if (!item.no_deco && !decos.length) issues.push(`${so.id} ${item.sku}: confirm blank garment or assign decoration`);
      decos.forEach((d, di) => {
        const art = arr(so.art_files).find(a => a.id === d.art_file_id && !a.archived);
        const mocks = files(slots.filter(s => s.di === di).flatMap(s => slotMockFiles(s, slots, item)));
        const cw = arr(art?.color_ways).find(c => c.id === d.color_way_id);
        const cwB = arr(art?.color_ways).find(c => c.id === d.color_way_id_b);
        const rosterSource = d.kind === 'names' ? d.names : d.roster;
        const roster = rosterSource && typeof rosterSource === 'object' && !Array.isArray(rosterSource) ? Object.entries(rosterSource).flatMap(([size, entries]) => arr(entries).slice(0, sizes[size] || 0).filter(v=>text(v).trim()).map(v=>({size,number:d.kind==='numbers'?text(v):'',name:d.kind==='names'?text(v):'',qty:1}))) : arr(rosterSource).map(r=>({size:text(r.size),number:text(r.number),name:text(r.name),qty:qty(r.qty||1)}));
        const override = qty(d.kind === 'numbers' ? d.num_qty : d.name_qty);
        const personalizedUnits = ['numbers','names'].includes(d.kind) ? (roster.reduce((n,r)=>n+r.qty,0) || override || units) : null;
        if (personalizedUnits != null && personalizedUnits > units) issues.push(`${so.id} ${item.sku}: personalization quantity exceeds garment quantity`);
        const did = `${id}:deco:${di}`;
        garment.decorationIds.push(did);
        const approved = ['approved', 'art_complete'].includes(art?.status);
        if (d.kind === 'art' && (!art || !approved)) issues.push(`${so.id} ${item.sku} ${d.position || ''}: artwork is not approved`);
        if (!mocks.length) issues.push(`${so.id} ${item.sku} ${d.position || d.kind}: garment mock missing`);
        // Complicated splits must be reviewed instead of silently printing the full garment count.
        const applicable = d.split_group ? sizeMap(d.split_sizes) : sizes;
        if (d.split_group && (!total(applicable) || Object.entries(applicable).some(([sz,n]) => n > (sizes[sz] || 0)))) issues.push(`${so.id} ${item.sku}: split decoration allocation is missing or exceeds garment sizes`);
        if (d.split_runs && arr(d.split_runs).length) issues.push(`${so.id} ${item.sku}: split decoration runs need quantity review`);
        decorations.push({ id: did, garmentId: id, soId: so.id, sku: garment.sku, color: garment.color, name: text(art?.name || d.kind || 'Decoration'), kind: text(d.kind), method: text(d.deco_type || art?.deco_type || d.type || d.num_method || d.name_method), position: text(d.position), dimensions: text(art?.art_size || d.num_size || d.dtf_size), colors: d.reversible ? `Side A: ${arr(cw?.inks).join(', ')} / Side B: ${arr(cwB?.inks).join(', ')}` : arr(cw?.inks).join(', ') || text(art?.ink_colors || art?.thread_colors || d.print_color), decorator: text(d.vendor), units: personalizedUnits == null ? total(applicable) : personalizedUnits, sizes: applicable, approved, mocks, productionFiles: files(art?.prod_files), personalization: { font: text(d.num_font), roster, names: text(d.names_list) } });
      });
      garments.push(garment);
    });
  });
  // Only unbatched active order lines use the store catalog. SO rows stay authoritative.
  const draftGroups = new Map();
  reconciled.lines.filter(l => !l._sourceSoId).forEach(l => {
    const matches = catalog.filter(c => (l.product_id && c.product_id === l.product_id) || c.sku === l.sku);
    const c = matches.length === 1 ? matches[0] : {};
    const ds = arr(l.decorations).length ? l.decorations : arr(c.decorations);
    const key = JSON.stringify([c.id || l.product_id || l.sku, l._effSku || l.sku, l.color, ds]);
    if (!draftGroups.has(key)) draftGroups.set(key, { c, ds, l, sizes: {} });
    const group = draftGroups.get(key), size = l._size || l.size || 'OS';
    group.sizes[size] = (group.sizes[size] || 0) + qty(l.qty);
  });
  draftGroups.forEach(({c,ds,l,sizes}, key) => {
    const id = `store:${encodeURIComponent(text(c.id||l.product_id||l.sku))}:${encodeURIComponent(text(l._effSku||l.sku))}:${encodeURIComponent(text(l.color))}:${[...draftGroups.keys()].indexOf(key)}`, units = total(sizes);
    const g = {id,soId:'',unbatched:true,sku:text(l._effSku||l.sku),name:text(l.name||c.display_name||l.sku),color:text(l.color),sizes,units,image:safeUrl(l.image_url||c.image_url),decorationIds:[],undecorated:false};
    ds.forEach((d,di)=>{
      const art=arr(store.store_art).find(a=>a.id===(d.art_id||d.art_file_id)&&!a.archived);
      const pick=d.cw_by_color?.[g.color.trim().toLowerCase()];
      const cw=arr(art?.color_ways).find(w=>w.id===(pick?.color_way_id||d.color_way_id));
      const pl=placementById(d.placement), bounded=(v,f)=>Number.isFinite(Number(v))?Math.max(0,Math.min(100,Number(v))):f;
      const preview={image:safeUrl(d.side==='back'?c.image_back_url:(l.image_url||c.image_url)),art:safeUrl((typeof pick==='string'?pick:pick?.url)||d.art_url||d.web_url||art?.web_logo_url),x:bounded(d.x??pl.x,pl.x),y:bounded(d.y??pl.y,pl.y),w:bounded(d.w??pl.w,pl.w),baked:!!d.baked};
      const did=`${id}:deco:${di}`;g.decorationIds.push(did);
      const mockItem={sku:g.sku,color:g.color};
      const mockDecos=ds.map(x=>({...x,kind:x.kind||'art',position:x.position||x.placement}));
      const slots=mockSlotKeys(garmentMockKey(mockItem),mockDecos).map(slot=>({...slot,artFile:arr(store.store_art).find(a=>a.id===(ds[slot.di]?.art_id||ds[slot.di]?.art_file_id)&&!a.archived)}));
      decorations.push({id:did,garmentId:id,soId:'',unbatched:true,sku:g.sku,color:g.color,name:text(art?.name||d.kind||'Store decoration'),kind:text(d.kind||'art'),method:text(d.deco_type||d.type||art?.deco_type),position:text(d.position||pl.label),dimensions:text(art?.art_size||d.num_size||d.dtf_size),colors:arr(cw?.inks).join(', ')||text(d.print_color),decorator:'',units,sizes,approved:['approved','art_complete'].includes(art?.status),mocks:files(slots.filter(slot=>slot.di===di).flatMap(slot=>slotMockFiles(slot,slots,mockItem))),storePreview:preview,productionFiles:files(art?.prod_files),personalization:{font:text(d.num_font),roster:[],names:''}});
    });
    garments.push(g);
  });
  if(draftGroups.size) issues.push('Store order quantities are awaiting an SO batch; review production assignments before issuing');
  const players = reconciled.lines.map((l, i) => {
    const order = reconciled.orderById[l.order_id] || {};
    if (l._verify || l._sizeVerify) issues.push(`${l._sourceSoId || 'Order'} ${l._effSku || l.sku}: player mapping needs verification`);
    return { id: `${text(l.id || 'extra')}:${text(l._effSku || l.sku)}:${text(l._size || l.size)}:${i}`, orderKey: text(l.order_id || 'extra'), orderId: text(order.order_number || order.omg_order_number || l.order_id), soId: text(l._sourceSoId), player: text(l.player_name || 'Unassigned'), number: text(l.player_number), sku: text(l._effSku || l._sku || l.sku), name: text(l._name || l.name), color: text(l._color || l.color), size: text(l._size || l.size), qty: qty(l.qty), wasSku: text(l._wasSku), wasSize: text(l._wasSize), unbatched: !l._sourceSoId, verify: !!(l._verify || l._unmatched || l._sizeVerify), extra: !!l._orderExtra };
  });
  const sharedNotes = notes.filter(n => !n.resolved_at && (!soId || !n.so_id || n.so_id === soId)).map(n => ({ id: n.id, soId: n.so_id, scope: n.scope, targetId: n.target_id, text: n.text, createdAt: n.created_at }));
  sharedNotes.filter(n => n.targetId && ![...garments,...decorations,...players].some(r=>r.id===n.targetId)).forEach(n=>issues.push(`Instruction target no longer exists: ${n.text.slice(0,80)}. Review and reassign this instruction.`));
  const sharedMessages = messages.filter(m => sos[m.soId]);
  sharedMessages.filter(m => ['question', 'action'].includes(m.kind) && !m.resolvedAt).forEach(m => issues.push(`${m.soId}: unresolved ${m.kind} — ${m.text.slice(0, 120)}`));
  if (!includedSos.length) issues.push('No linked sales order is ready for production');
  const uniqueIssues = [...new Set(issues)];
  return { schemaVersion: 1, store: { id: store.id, name: store.name, logoUrl: safeUrl(store.logo_url), primaryColor: /^#[0-9a-f]{6}$/i.test(store.primary_color || '') ? store.primary_color : '#19333c', accentColor: /^#[0-9a-f]{6}$/i.test(store.accent_color || '') ? store.accent_color : '#167b6e', deliveryMode: store.delivery_mode || '' }, soId, salesOrders: includedSos.map(s => ({ id: s.id, dueDate: s.expected_date || s.due_date || null, status: s.status })), garments, decorations, players, notes: sharedNotes, messages: sharedMessages, issues: uniqueIssues, ready: !uniqueIssues.length, changes: { substitutions: reconciled.audit.substitutions, sizeChanges: reconciled.audit.sizeChanges }, totals: { garments: garments.reduce((n, g) => n + g.units, 0), playerUnits: players.filter(p => !p.unbatched).reduce((n, p) => n + p.qty, 0), unbatchedUnits: players.filter(p => p.unbatched).reduce((n, p) => n + p.qty, 0), players: new Set(players.filter(p => !p.extra).map(p => `${p.orderId}:${p.player}`)).size } };
}

export function packetChanges(previous, current) {
  if (!previous) return [];
  const out = [];
  for (const key of ['garments', 'decorations', 'players', 'notes', 'messages']) {
    const before = new Map((previous[key] || []).map(x => [x.id, x]));
    for (const row of current[key] || []) {
      const old = before.get(row.id);
      if (!old) out.push(`Added ${key}: ${row.sku || row.player || row.text || row.id}`);
      else if (JSON.stringify(old) !== JSON.stringify(row)) out.push(`Updated ${key}: ${row.sku || row.player || row.text || row.id}${key === 'garments' ? ` (${old.units} → ${row.units} units)` : ''}`);
      before.delete(row.id);
    }
    for (const row of before.values()) out.push(`Removed ${key}: ${row.sku || row.player || row.text || row.id}`);
  }
  return out;
}

export function groupPlayerOrders(players, search = '') {
  const groups = new Map();
  players.forEach(r=>{const key=r.orderKey||r.orderId;if(!groups.has(key))groups.set(key,{id:key,orderId:r.orderId,rows:[],units:0});const g=groups.get(key);g.rows.push(r);g.units+=r.qty;});
  const needle=search.trim().toLowerCase();
  return [...groups.values()].filter(g=>!needle||g.rows.some(r=>`${r.player} ${r.number} ${r.orderId} ${r.sku} ${r.size}`.toLowerCase().includes(needle))).sort((a,b)=>a.orderId.localeCompare(b.orderId,undefined,{numeric:true}));
}
export function playerItemCsv(players) {
  const cell=v=>'"'+String(v??'').replace(/^[=+@\-\t\r]/,"'$&").replace(/"/g,'""')+'"';
  return [['Order','Player','Number','SO','SKU','Garment','Color','Size','Quantity'],...players.map(r=>[r.orderId,r.player,r.number,r.soId,r.sku,r.name,r.color,r.size,r.qty])].map(row=>row.map(cell).join(',')).join('\r\n');
}
