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
const colorText = value => Array.isArray(value) ? value.map(v=>typeof v==='object'?[v.code,v.name].filter(Boolean).join(' '):text(v)).join(', ') : text(value);
export const isPersonalization = value => ['names','numbers'].includes(typeof value === 'string' ? value : value?.kind);
export const productionLabel = value => {
  const kind=typeof value === 'string' ? value : value?.kind;
  if(kind==='names')return 'Player names';
  if(kind==='numbers')return 'Player numbers';
  return text(typeof value === 'string' ? value : value?.name) || 'Decoration artwork';
};
export const humanizeProductionValue = value => text(value).replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase());
export function artSpecs(art, decoration, colorWay) {
 const position=decoration.position||placementById(decoration.placement).label;
 const embroidery=(decoration.deco_type||decoration.type||art?.deco_type)==='embroidery';
 return {dimensions:text(art?.art_sizes?.[position]||art?.art_sizes?.[decoration.placement]||art?.art_size||decoration.num_size||decoration.dtf_size),pantoneColors:embroidery?'':colorText(colorWay?.inks)||colorText(art?.ink_colors),threadColors:embroidery?(colorText(colorWay?.inks)||colorText(art?.thread_colors)):colorText(art?.thread_colors),stitches:qty(art?.stitches||decoration.stitches)||null};
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
  const issueDetails = issues.map((value, index) => ({ id: `issue:${index}`, text: value, section: 'players', targetId: null, soId: (value.match(/^(SO-[^ :]+)/) || [])[1] || null }));
  const addIssue = (value, section = 'garments', targetId = null, issueSoId = null) => { if (!issues.includes(value)) { issues.push(value); issueDetails.push({ id: `issue:${issueDetails.length}`, text: value, section, targetId, soId: issueSoId }); } };
  const garments = [], decorations = [];
  includedSos.forEach(so => {
    const seen = new Set();
    arr(so.items).forEach((item, index) => {
      const legacyId = `${so.id}:${item.line_id || item.id || index}`;
      const id = item.id != null ? `garment:${text(item.id)}` : legacyId;
      if (item.item_index != null && seen.has(item.item_index)) addIssue(`${so.id}: duplicate item position ${item.item_index}; repair before issuing`);
      seen.add(item.item_index);
      if (isServiceLine(item)) return;
      const sizes = sizeMap(item.sizes), units = total(sizes);
      if (item.qty_only && qty(item.est_qty) && !units) addIssue(`${so.id} ${item.sku}: quantity-only garment needs a size allocation`);
      if (!units) return;
      const decos = arr(item.decorations);
      const slots = mockSlotKeys(garmentMockKey(item), decos).map(slot => ({ ...slot, artFile: arr(so.art_files).find(a => a.id === (decos[slot.di]?.art_file_id || arr(so.jobs).find(j=>arr(j.items).some(ji=>ji.item_idx===(item.item_index ?? index) && (!Array.isArray(ji.deco_idxs)||ji.deco_idxs.includes(slot.di))))?.art_file_id) && !a.archived) }));
      const garment = { id, legacyIds: id === legacyId ? [] : [legacyId], soId: so.id, sku: text(item.sku), name: text(item.name || item.custom_desc || item.sku), color: text(item.color), sizes, units, image: safeUrl(item.image_front_url), decorationIds: [], undecorated: !!item.no_deco };
      if (!item.no_deco && !decos.length) addIssue(`${so.id} ${item.sku}: confirm blank garment or assign decoration`);
      decos.forEach((d, di) => {
        const art = arr(so.art_files).find(a => a.id === d.art_file_id && !a.archived);
        const mocks = files(slots.filter(s => s.di === di).flatMap(s => slotMockFiles(s, slots, item)));
        const cw = arr(art?.color_ways).find(c => c.id === d.color_way_id);
        const cwB = arr(art?.color_ways).find(c => c.id === d.color_way_id_b);
        const personalization = isPersonalization(d);
        const legacyDid = `${legacyId}:deco:${di}`;
        const did = d.id != null ? `decoration:${text(d.id)}` : `${id}:deco:${di}`;
        const rosterSource = d.kind === 'names' ? d.names : d.roster;
        const rosterEntry = (value, size = '') => typeof value === 'object' && value !== null
          ? { size: text(value.size || size), number: text(value.number || (d.kind === 'numbers' ? value.value : '')), name: text(value.name || (d.kind === 'names' ? value.value : '')), qty: value.qty == null ? 1 : qty(value.qty) }
          : { size: text(size), number: d.kind === 'numbers' ? text(value) : '', name: d.kind === 'names' ? text(value) : '', qty: 1 };
        const roster = rosterSource && typeof rosterSource === 'object' && !Array.isArray(rosterSource)
          ? Object.entries(rosterSource).flatMap(([size, entries]) => arr(entries).filter(v => (typeof v === 'object' ? text(v.number || v.name || v.value).trim() : text(v).trim())).map(v => rosterEntry(v, size)))
          : arr(rosterSource).map(r => rosterEntry(r)).filter(r => r.name || r.number);
        const overrideValue = d.kind === 'numbers' ? d.num_qty : d.name_qty;
        const override = qty(overrideValue);
        const rosterUnits = roster.reduce((n,r)=>n+r.qty,0);
        const personalizedUnits = ['numbers','names'].includes(d.kind) ? (rosterUnits || override || units) : null;
        if (personalization) {
          const bySize = roster.reduce((out, r) => ({ ...out, [r.size]: (out[r.size] || 0) + r.qty }), {});
          const hasRoster = roster.length > 0;
          if (roster.some(r => r.qty <= 0)) addIssue(`${so.id} ${item.sku}: ${productionLabel(d)} roster contains a zero quantity`, 'decorations', did, so.id);
          if (!hasRoster && !override) addIssue(`${so.id} ${item.sku}: ${productionLabel(d)} roster is missing`, 'decorations', did, so.id);
          const expectedBySize = d.split_group ? sizeMap(d.split_sizes) : null;
          const expectedTotal = override > 0 ? override : expectedBySize ? total(expectedBySize) : null;
          const wrongSizes = expectedBySize && Object.keys({...expectedBySize,...bySize}).some(sz => (bySize[sz] || 0) !== (expectedBySize[sz] || 0));
          if (hasRoster && ((expectedTotal != null && rosterUnits !== expectedTotal) || wrongSizes)) addIssue(`${so.id} ${item.sku}: ${productionLabel(d)} roster does not match declared quantity or size allocation`, 'decorations', did, so.id);
          if (personalizedUnits > units) addIssue(`${so.id} ${item.sku}: personalization quantity exceeds garment quantity`, 'decorations', did, so.id);
        }
        garment.decorationIds.push(did);
        const approved = ['approved', 'art_complete'].includes(art?.status);
        if (d.kind === 'art' && (!art || !approved)) addIssue(`${so.id} ${item.sku} ${d.position || ''}: artwork is not approved`, 'decorations', did, so.id);
        // Names and numbers are production applications, not artwork. They do not
        // require a separate garment-art mock and must not block an otherwise ready packet.
        if (!personalization && !mocks.length) addIssue(`${so.id} ${item.sku} ${d.position || d.kind}: garment mock missing`, 'decorations', did, so.id);
        // Complicated splits must be reviewed instead of silently printing the full garment count.
        const applicable = personalization && roster.length ? roster.reduce((out,r)=>({...out,[r.size]:(out[r.size]||0)+r.qty}),{}) : d.split_group ? sizeMap(d.split_sizes) : sizes;
        if (d.split_group && (!total(applicable) || Object.entries(applicable).some(([sz,n]) => n > (sizes[sz] || 0)))) addIssue(`${so.id} ${item.sku}: split decoration allocation is missing or exceeds garment sizes`, 'decorations', did, so.id);
        if (d.split_runs && arr(d.split_runs).length) addIssue(`${so.id} ${item.sku}: split decoration runs need quantity review`, 'decorations', did, so.id);
        const method=d.kind==='names'?(d.name_method||'heat_press'):d.kind==='numbers'?(d.num_method||'heat_transfer'):(d.deco_type||art?.deco_type||d.type);
        const specs = artSpecs(art,d,cw), methodKey = text(method).toLowerCase(), missingSpecs = [];
        const knownMethods = ['screen_print','sublimated','dtf','heat_transfer','heat_press','tackle_twill','embroidery'];
        const position = text(d.position || (d.placement ? placementById(d.placement).label : ''));
        if (!knownMethods.includes(methodKey)) missingSpecs.push('known method');
        if (!position || (d.placement && placementById(d.placement).id !== d.placement && !d.position)) missingSpecs.push('known placement');
        if (d.kind === 'names') { if (!text(d.num_font)) missingSpecs.push('font'); if (!specs.dimensions) missingSpecs.push('dimensions'); if (!text(d.print_color) && !specs.threadColors && !specs.pantoneColors) missingSpecs.push('colors'); }
        if (d.kind === 'numbers') {
          if (!text(d.num_size)) missingSpecs.push('dimensions');
          if (!text(d.print_color) && !colorText(cw?.inks) && !colorText(art?.ink_colors)) missingSpecs.push('colors');
          if (methodKey === 'screen_print' && !text(d.num_font)) missingSpecs.push('font');
        } else if (!personalization) {
          if (!specs.dimensions) missingSpecs.push('dimensions');
          if (methodKey === 'embroidery' ? !specs.threadColors : !specs.pantoneColors) missingSpecs.push(methodKey === 'embroidery' ? 'thread colors' : 'colors');
          if (methodKey === 'embroidery' && !specs.stitches) missingSpecs.push('stitch count');
          if (!files(art?.prod_files).length) missingSpecs.push('production files');
        }
        const uniqueMissingSpecs = [...new Set(missingSpecs)];
        const specReady = uniqueMissingSpecs.length === 0;
        if (!specReady) addIssue(`${so.id} ${item.sku}: ${productionLabel(d)} specs missing ${uniqueMissingSpecs.join(', ')}`, 'decorations', did, so.id);
        decorations.push({ id: did, legacyIds: [legacyDid], garmentId: id, soId: so.id, sku: garment.sku, color: garment.color, name: text(art?.name || productionLabel(d)), kind: text(d.kind), isPersonalization: personalization, method: text(method), position, dimensions: text(art?.art_size || d.num_size || d.dtf_size), colors: d.reversible ? `Side A: ${arr(cw?.inks).join(', ')} / Side B: ${arr(cwB?.inks).join(', ')}` : arr(cw?.inks).join(', ') || text(art?.ink_colors || art?.thread_colors || d.print_color), ...artSpecs(art,d,cw), decorator: text(d.vendor), units: personalizedUnits == null ? total(applicable) : personalizedUnits, sizes: applicable, approved: personalization ? null : approved, mocks, productionFiles: files(art?.prod_files), specReady, missingSpecs: uniqueMissingSpecs, personalization: { font: text(d.num_font), roster, names: text(d.names_list) } });
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
      const kind=text(d.kind||'art'), personalization=isPersonalization(kind), method=kind==='names'?(d.name_method||'heat_press'):kind==='numbers'?(d.num_method||'heat_transfer'):(d.deco_type||d.type||art?.deco_type);
      decorations.push({id:did,legacyIds:[],garmentId:id,soId:'',unbatched:true,sku:g.sku,color:g.color,name:text(art?.name||productionLabel(kind)),kind,isPersonalization:personalization,method:text(method),position:text(d.position||pl.label),dimensions:text(art?.art_size||d.num_size||d.dtf_size),colors:arr(cw?.inks).join(', ')||text(d.print_color),...artSpecs(art,d,cw),decorator:'',units,sizes,approved:personalization?null:['approved','art_complete'].includes(art?.status),mocks:files(slots.filter(slot=>slot.di===di).flatMap(slot=>slotMockFiles(slot,slots,mockItem))),storePreview:personalization?null:preview,productionFiles:files(art?.prod_files),personalization:{font:text(d.num_font),roster:[],names:''}});
    });
    garments.push(g);
  });
  if(draftGroups.size) addIssue('Store order quantities are awaiting an SO batch; review production assignments before issuing', 'garments');
  const players = reconciled.lines.map((l, i) => {
    const order = reconciled.orderById[l.order_id] || {};
    if (l._verify || l._sizeVerify) addIssue(`${l._sourceSoId || 'Order'} ${l._effSku || l.sku}: player mapping needs verification`);
    const legacyPlayerId = `${text(l.id || 'extra')}:${text(l._effSku || l.sku)}:${text(l._size || l.size)}:${i}`;
    return { id: l.id != null ? `player:${text(l.id)}:${text(l._effSku || l.sku)}:${text(l._size || l.size)}` : legacyPlayerId, legacyIds: l.id != null ? [legacyPlayerId] : [], orderKey: text(l.order_id || 'extra'), orderId: text(order.order_number || order.omg_order_number || l.order_id), soId: text(l._sourceSoId), player: text(l.player_name || 'Unassigned'), number: text(l.player_number), sku: text(l._effSku || l._sku || l.sku), name: text(l._name || l.name || catalog.find(c=>c.product_id===l.product_id)?.display_name), color: text(l._color || l.color), size: text(l._size || l.size), qty: qty(l.qty), wasSku: text(l._wasSku), wasSize: text(l._wasSize), unbatched: !l._sourceSoId, verify: !!(l._verify || l._unmatched || l._sizeVerify), extra: !!l._orderExtra };
  });
  const aliases = new Map([...garments, ...players, ...decorations.filter(row => !row.id.startsWith('decoration:'))].flatMap(row => (row.legacyIds || []).map(old => [old, row.id])));
  const sharedNotes = notes.filter(n => !n.resolved_at && (!soId || !n.so_id || n.so_id === soId)).map(n => ({ id: n.id, soId: n.so_id, scope: n.scope, targetId: aliases.get(n.target_id) || n.target_id, text: n.text, createdAt: n.created_at }));
  sharedNotes.filter(n => n.targetId && ![...garments,...decorations,...players].some(r=>r.id===n.targetId)).forEach(n=>addIssue(`Instruction target no longer exists or is ambiguous: ${n.text.slice(0,80)}. Review and reassign this instruction.`, n.scope === 'player' ? 'players' : n.scope === 'decoration' ? 'decorations' : 'garments', n.targetId, n.soId));
  const sharedMessages = messages.filter(m => sos[m.soId]).map(m=>({...m,targetId:aliases.get(m.targetId)||m.targetId}));
  sharedMessages.filter(m => ['question', 'action'].includes(m.kind) && !m.resolvedAt).forEach(m => addIssue(`${m.soId}: unresolved ${m.kind} — ${m.text.slice(0, 120)}`, 'messages', m.id, m.soId));
  if (!includedSos.length) addIssue('No linked sales order is ready for production', 'garments');
  const uniqueIssues = [...new Set(issues)];
  return { schemaVersion: 1, store: { id: store.id, name: store.name, logoUrl: safeUrl(store.logo_url), primaryColor: /^#[0-9a-f]{6}$/i.test(store.primary_color || '') ? store.primary_color : '#19333c', accentColor: /^#[0-9a-f]{6}$/i.test(store.accent_color || '') ? store.accent_color : '#167b6e', deliveryMode: store.delivery_mode || '' }, soId, salesOrders: includedSos.map(s => ({ id: s.id, dueDate: s.expected_date || s.due_date || null, status: s.status })), garments, decorations, players, notes: sharedNotes, messages: sharedMessages, issues: uniqueIssues, issueDetails: issueDetails.filter((row, index, rows) => rows.findIndex(x => x.text === row.text) === index), ready: !uniqueIssues.length, changes: { substitutions: reconciled.audit.substitutions, sizeChanges: reconciled.audit.sizeChanges }, totals: { garments: garments.reduce((n, g) => n + g.units, 0), playerUnits: players.filter(p => !p.unbatched).reduce((n, p) => n + p.qty, 0), unbatchedUnits: players.filter(p => p.unbatched).reduce((n, p) => n + p.qty, 0), orders: new Set(players.filter(p => !p.extra).map(p => p.orderKey)).size, players: new Set(players.filter(p => !p.extra).map(p => `${p.orderId}:${p.player}`)).size } };
}

export function packetChanges(previous, current) {
  if (!previous) return [];
  const out = [];
  const label = row => row.sku || row.player || row.text || row.id;
  for (const key of ['garments', 'decorations', 'players', 'notes']) {
    const before = new Map();
    (previous[key] || []).forEach(row => [row.id, ...(row.legacyIds || [])].filter(Boolean).forEach(id => before.set(id, row)));
    for (const row of current[key] || []) {
      const old = before.get(row.id) || (row.legacyIds || []).map(id => before.get(id)).find(Boolean);
      if (!old) out.push(`Added ${key}: ${label(row)}`);
      else if (JSON.stringify(old) !== JSON.stringify(row)) {
        const changes = [];
        const fields = key === 'garments' ? ['sku', 'name', 'color', 'sizes', 'units'] : key === 'decorations' ? ['name', 'method', 'position', 'dimensions', 'colors', 'threadColors', 'pantoneColors', 'stitches', 'units', 'sizes', 'approved', 'productionFiles', 'personalization'] : key === 'players' ? ['player', 'number', 'sku', 'name', 'color', 'size', 'qty', 'verify'] : ['text', 'scope', 'targetId'];
        fields.forEach(field => { if (JSON.stringify(old[field]) !== JSON.stringify(row[field])) changes.push(`${field}: ${JSON.stringify(old[field] ?? '')} → ${JSON.stringify(row[field] ?? '')}`); });
        if(changes.length)out.push(`Updated ${key}: ${label(row)} (${changes.join('; ')})`);
      }
      [row.id, ...(row.legacyIds || [])].filter(Boolean).forEach(id => before.delete(id));
    }
    const removed = new Set(before.values());
    removed.forEach(row => out.push(`Removed ${key}: ${label(row)}`));
  }
  for(const field of ['store','salesOrders']) { if(JSON.stringify(previous[field])!==JSON.stringify(current[field]))out.push(`Updated ${field === 'store'?'store details':'sales order status or due date'}`); }
  return out;
}

export function groupPlayerOrders(players, search = '') {
  const groups = new Map();
  players.forEach(r=>{const key=r.orderKey||r.orderId;if(!groups.has(key))groups.set(key,{id:key,orderId:r.orderId,rows:[],units:0});const g=groups.get(key);g.rows.push(r);g.units+=r.qty;});
  const needle=search.trim().toLowerCase();
  return [...groups.values()].map(g=>({...g,recipient:[...new Set(g.rows.map(r=>r.player).filter(Boolean))].join(' · ')})).filter(g=>!needle||g.rows.some(r=>`${r.player} ${r.number} ${r.orderId} ${r.sku} ${r.size}`.toLowerCase().includes(needle))).sort((a,b)=>a.orderId.localeCompare(b.orderId,undefined,{numeric:true}));
}
export function playerItemCsv(players) {
  const cell=v=>'"'+String(v??'').replace(/^[=+@\-\t\r]/,"'$&").replace(/"/g,'""')+'"';
  return [['Order','Player','Number','SO','SKU','Garment','Color','Size','Quantity'],...players.map(r=>[r.orderId,r.player,r.number,r.soId,r.sku,r.name,r.color,r.size,r.qty])].map(row=>row.map(cell).join(',')).join('\r\n');
}
