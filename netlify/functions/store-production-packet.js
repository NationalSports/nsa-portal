const crypto = require('crypto');
const { verifyUser, getSupabaseAdmin } = require('./_shared');
const { buildProductionPacket, packetChanges, safeUrl } = require('../../src/productionPacket/model');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const fail = (status, message) => { const e = new Error(message); e.status = status; throw e; };
const checked = async query => { const { data, error } = await query; if (error) throw new Error(error.message); return data; };
const clean = v => typeof v === 'string' ? v.trim() : '';
// PostgREST defaults to 1000 records: page all source tables, never truncate players.
async function all(makeQuery) {
  const rows = [];
  for (let start = 0; ; start += 500) {
    const page = await checked(makeQuery().range(start, start + 499));
    rows.push(...page);
    if (page.length < 500) return rows;
    if (rows.length >= 50000) fail(413, 'Store is too large for one packet; select a sales order');
  }
}
async function inBatches(admin, table, column, ids, columns = '*') {
  const rows = [];
  for (let i = 0; i < ids.length; i += 100) rows.push(...await all(() => admin.from(table).select(columns).in(column, ids.slice(i, i + 100)).order('id')));
  return rows;
}
async function authorize(event, body) {
  if (body.token) {
    if (!/^[a-f0-9]{64}$/.test(body.token)) fail(403, 'Link is invalid or expired');
    const admin = getSupabaseAdmin();
    const link = await checked(admin.from('production_packet_links').select('*').eq('token_hash', hash(body.token)).maybeSingle());
    if (!link || link.revoked_at || Date.parse(link.expires_at) <= Date.now()) fail(403, 'Link is invalid or expired');
    return { admin, link, staff: false, storeId: link.store_id, soId: link.so_id || null };
  }
  const auth = await verifyUser(event);
  if (!auth.ok) fail(auth.status || 401, auth.error);
  const admin = auth.admin || getSupabaseAdmin();
  let storeId = clean(body.store_id);
  if (!storeId && body.so_id) {
    const so = await checked(admin.from('sales_orders').select('webstore_id').eq('id', body.so_id).maybeSingle());
    storeId = so?.webstore_id;
  }
  if (!storeId) fail(400, 'This order does not have a linked webstore');
  return { admin, staff: true, storeId, soId: clean(body.scope_so_id) || null, actorId: auth.teamMemberId };
}
async function loadCurrent(ctx) {
  const { admin, storeId, soId } = ctx;
  const [store, orders, salesOrders, catalog, notes, shares] = await Promise.all([
    checked(admin.from('webstores').select('id,name,delivery_mode').eq('id', storeId).single()),
    all(() => admin.from('webstore_orders').select('id,store_id,so_id,order_number,omg_order_number,status,backorder_of').eq('store_id', storeId).order('id')),
    all(() => admin.from('sales_orders').select('id,webstore_id,status,expected_date,production_notes,deco_pos').eq('webstore_id', storeId).order('id')),
    all(() => admin.from('webstore_products').select('id,product_id,size_skus').eq('store_id', storeId).order('id')),
    all(() => admin.from('production_packet_notes').select('*').eq('store_id', storeId).order('id')),
    all(() => admin.from('production_packet_message_shares').select('*').eq('store_id', storeId).order('message_id')),
  ]);
  if (soId && !salesOrders.some(s => s.id === soId)) fail(403, 'Sales order is outside this store');
  const ids = salesOrders.map(s => s.id);
  const [items, arts, lines, allMessages, jobs] = await Promise.all([
    inBatches(admin, 'so_items', 'so_id', ids),
    inBatches(admin, 'so_art_files', 'so_id', ids),
    inBatches(admin, 'webstore_order_items', 'order_id', orders.map(o => o.id)),
    inBatches(admin, 'messages', 'so_id', ids, 'id,so_id,author_id,author,text,ts,thread_id,attachments'),
    inBatches(admin, 'so_jobs', 'so_id', ids),
  ]);
  const decos = await inBatches(admin, 'so_item_decorations', 'so_item_id', items.map(i => i.id));
  salesOrders.forEach(so => {
    so.items = items.filter(i => i.so_id === so.id).sort((a, b) => a.item_index - b.item_index).map(i => ({ ...i, decorations: decos.filter(d => d.so_item_id === i.id).sort((a, b) => a.deco_index - b.deco_index) }));
    so.jobs = jobs.filter(j => j.so_id === so.id);
    so.art_files = arts.filter(a => a.so_id === so.id);
  });
  const authorIds = [...new Set(allMessages.map(m => m.author_id).filter(Boolean))];
  const authors = await inBatches(admin, 'team_members', 'id', authorIds, 'id,name');
  const shareById = Object.fromEntries(shares.map(s => [s.message_id, s]));
  const messages = allMessages.filter(m => shareById[m.id]).map(m => {
    const share = shareById[m.id];
    return { id: m.id, soId: m.so_id, text: m.text || '', author: authors.find(a => a.id === m.author_id)?.name || m.author || 'Decorator', ts: m.ts, threadId: shareById[m.thread_id] ? m.thread_id : null, source: share.source, kind: share.kind, targetId: share.target_id, ownerId: share.owner_id, resolvedAt: share.resolved_at, attachments: (Array.isArray(m.attachments) ? m.attachments : []).map(f => ({ name: f.name || 'Attachment', url: safeUrl(f.url) })).filter(f => f.url) };
  }).sort((a, b) => a.id.localeCompare(b.id));
  const packet = buildProductionPacket({ store, orders, lines, salesOrders, catalog, notes, messages, soId });
  packet.fingerprint = hash(JSON.stringify(packet));
  const internal = ctx.staff ? {
    notes: salesOrders.filter(s => !soId || s.id === soId).flatMap(s => [
      ...(s.production_notes ? [{soId:s.id,scope:'so',text:s.production_notes}] : []),
      ...s.items.flatMap(it => [
        ...(it.notes ? [{soId:s.id,scope:'garment',text:it.notes,label:it.sku}] : []),
        ...it.decorations.filter(d=>d.notes).map(d=>({soId:s.id,scope:'decoration',text:d.notes,label:`${it.sku} ${d.position||''}`})),
      ]),
      ...s.art_files.filter(a=>a.notes).map(a=>({soId:s.id,scope:'decoration',text:a.notes,label:a.name})),
    ]),
    messages: allMessages.filter(m => (!soId || m.so_id === soId) && !shareById[m.id]).map(m => ({ id: m.id, soId: m.so_id, text: m.text, ts: m.ts, author: authors.find(a => a.id === m.author_id)?.name || m.author || 'Staff', attachmentCount: (m.attachments || []).length })),
  } : undefined;
  return { packet, internal };
}
async function latestRevision(ctx) {
  let q = ctx.admin.from('production_packet_revisions').select('id,created_at,fingerprint,snapshot').eq('store_id', ctx.storeId);
  q = ctx.soId ? q.eq('so_id', ctx.soId) : q.is('so_id', null);
  return checked(q.order('created_at', { ascending: false }).limit(1).maybeSingle());
}
async function revisionFor(ctx, revisionId) {
  const row = await checked(ctx.admin.from('production_packet_revisions').select('*').eq('id', revisionId).eq('store_id', ctx.storeId).maybeSingle());
  if (!row || (row.so_id || null) !== ctx.soId) fail(404, 'Revision not found for this scope');
  return row;
}
async function run(event, body) {
  const ctx = await authorize(event, body);
  const { admin, storeId, staff } = ctx;
  const action = body.action || 'view';
  if (!['view', 'message'].includes(action) && !staff) fail(403, 'Staff access required');
  if (action === 'view') {
    const { packet: current, internal } = await loadCurrent(ctx);
    const latest = await latestRevision(ctx);
    const revision = body.revision_id ? await revisionFor(ctx, body.revision_id) : null;
    const links = staff ? await all(() => admin.from('production_packet_links').select('id,label,so_id,created_at,expires_at,revoked_at').eq('store_id', storeId).order('id')) : undefined;
    return { packet: revision ? { ...revision.snapshot, revisionId: revision.id, issuedAt: revision.created_at } : current, staff, internal, links, scopeSoId: ctx.soId, fetchedAt: new Date().toISOString(), latestRevision: latest && { id: latest.id, createdAt: latest.created_at, fingerprint: latest.fingerprint }, changedSinceIssue: latest ? packetChanges(latest.snapshot, current) : [], newerChanges: revision ? packetChanges(revision.snapshot, current) : [] };
  }
  if (action === 'revoke') {
    await checked(admin.from('production_packet_links').update({ revoked_at: new Date().toISOString() }).eq('id', body.link_id).eq('store_id', storeId));
    return { ok: true };
  }
  const { packet } = await loadCurrent(ctx);
  const assertSo = id => { if (!packet.salesOrders.some(s => s.id === id)) fail(403, 'Choose a sales order in this packet'); };
  const assertTarget = id => { if (id && ![...packet.garments, ...packet.decorations, ...packet.players].some(x => x.id === id)) fail(400, 'Item no longer exists in this packet'); };
  if (action === 'create_link') {
    const label = clean(body.label).slice(0, 100);
    if (!label) fail(400, 'Name this recipient link');
    const token = crypto.randomBytes(32).toString('hex');
    const row = await checked(admin.from('production_packet_links').insert({ store_id: storeId, so_id: ctx.soId, token_hash: hash(token), label, created_by: ctx.actorId, expires_at: new Date(Date.now() + 90 * 86400000).toISOString() }).select('id').single());
    return { id: row.id, token };
  }
  if (action === 'issue') {
    if (packet.fingerprint !== body.fingerprint) fail(409, 'Packet changed. Refresh and review before issuing.');
    if (!packet.ready) fail(409, 'Resolve production issues before issuing this packet');
    const latest = await latestRevision(ctx);
    if (latest?.fingerprint === packet.fingerprint) return { revisionId: latest.id };
    const row = await checked(admin.from('production_packet_revisions').insert({ store_id: storeId, so_id: ctx.soId, fingerprint: packet.fingerprint, snapshot: packet, created_by: ctx.actorId }).select('id').single());
    return { revisionId: row.id };
  }
  if (action === 'note') {
    const text = clean(body.text); if (!text || text.length > 10000) fail(400, 'Instruction must contain 1–10000 characters');
    const scope = body.scope || 'store';
    if (!['store', 'so', 'garment', 'decoration', 'player'].includes(scope)) fail(400, 'Unknown instruction scope');
    const soId = clean(body.target_so_id) || null;
    if (scope !== 'store' && !soId) fail(400, 'Choose an SO for this instruction');
    if (soId) assertSo(soId);
    const targetId = clean(body.target_id);
    if (['garment', 'decoration', 'player'].includes(scope)) {
      const rows = scope === 'garment' ? packet.garments : scope === 'decoration' ? packet.decorations : packet.players;
      if (!rows.some(r => r.id === targetId && r.soId === soId)) fail(400, 'Instruction target does not belong to the chosen SO');
    }
    await checked(admin.from('production_packet_notes').insert({ store_id: storeId, so_id: soId, scope, target_id: targetId, text, created_by: ctx.actorId }));
    return { ok: true };
  }
  if (action === 'archive_note') {
    await checked(admin.from('production_packet_notes').update({ resolved_at: new Date().toISOString() }).eq('id', body.note_id).eq('store_id', storeId)); return { ok: true };
  }
  if (action === 'share_message') {
    const message = await checked(admin.from('messages').select('id,so_id').eq('id', body.message_id).single());
    assertSo(message.so_id);
    await checked(admin.from('production_packet_message_shares').upsert({ message_id: message.id, store_id: storeId, shared_by: ctx.actorId, source: 'staff', kind: 'message' }, { onConflict: 'message_id', ignoreDuplicates: true }));
    return { ok: true };
  }
  if (action === 'resolve_message' || action === 'unshare_message') {
    const message = packet.messages.find(m => m.id === body.message_id);
    if (!message) fail(404, 'Shared message not found');
    if (action === 'unshare_message') await checked(admin.from('production_packet_message_shares').delete().eq('message_id', message.id).eq('store_id', storeId));
    else await checked(admin.from('production_packet_message_shares').update({ resolved_at: body.resolved === false ? null : new Date().toISOString() }).eq('message_id', message.id).eq('store_id', storeId));
    return { ok: true };
  }
  if (action === 'message') {
    const soId = clean(body.target_so_id); assertSo(soId);
    const text = clean(body.text); if (!text || text.length > 10000) fail(400, 'Message must contain 1–10000 characters');
    const kind = ['message', 'question', 'action'].includes(body.kind) ? body.kind : 'message';
    const targetId = clean(body.target_id); assertTarget(targetId);
    if (targetId && ![...packet.garments, ...packet.decorations, ...packet.players].some(r => r.id === targetId && r.soId === soId)) fail(400, 'Message item belongs to another SO');
    const parent = body.thread_id ? packet.messages.find(m => m.id === body.thread_id && m.soId === soId) : null;
    if (body.thread_id && !parent) fail(400, 'Reply target is not a shared message on this SO');
    const id = `packet-${crypto.randomUUID()}`;
    await checked(admin.from('messages').insert({ id, so_id: soId, author_id: staff ? ctx.actorId : null, author: staff ? null : `Decorator: ${ctx.link.label}`, text, ts: new Date().toISOString(), dept: 'production', entity_type: 'so', entity_id: soId, thread_id: parent?.id || null }));
    try {
      await checked(admin.from('production_packet_message_shares').insert({ message_id: id, store_id: storeId, shared_by: staff ? ctx.actorId : null, link_id: ctx.link?.id || null, source: staff ? 'staff' : 'decorator', kind, target_id: targetId }));
    } catch (e) {
      await checked(admin.from('messages').delete().eq('id', id));
      throw e;
    }
    return { ok: true, id };
  }
  fail(400, 'Unknown packet action');
}
exports.handler = async event => {
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'POST required' }) };
  try {
    if ((event.body || '').length > 40000) fail(413, 'Request too large');
    let body; try { body = JSON.parse(event.body || '{}'); } catch { fail(400, 'Invalid JSON'); }
    const result = await run(event, body);
    return { statusCode: 200, headers, body: JSON.stringify(result) };
  } catch (e) { return { statusCode: e.status || 500, headers, body: JSON.stringify({ error: e.status ? e.message : 'Could not load or save production packet. Retry or contact staff.', detail: undefined }) }; }
};
exports._internals = { authorize, loadCurrent, revisionFor, run, all, hash };
