// Store-scoped, revocable decorator link. Never return prices, addresses, emails,
// internal customer art libraries, or unrelated stores through this endpoint.
const crypto = require('crypto');
const { getSupabaseAdmin, verifyUser } = require('./_shared');

const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' };
const reply = (statusCode, body) => ({ statusCode, headers, body: JSON.stringify(body) });
const hash = (token) => crypto.createHash('sha256').update(token).digest('hex');
const tokenOk = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const cipherKey = () => crypto.createHash('sha256').update(process.env.SUPABASE_SERVICE_ROLE_KEY || '').digest();
function encrypt(token) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', cipherKey(), iv);
  const bytes = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), bytes]).toString('base64');
}
function decrypt(encoded) {
  const bytes = Buffer.from(encoded, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', cipherKey(), bytes.subarray(0, 12));
  decipher.setAuthTag(bytes.subarray(12, 28));
  return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8');
}

async function pages(build) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build().range(from, from + 999);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < 1000) return rows;
    if (rows.length > 50000) throw new Error('Store is too large for one report');
  }
}

async function scopedChildren(db, table, ids) {
  const rows = [];
  for (let start = 0; start < ids.length; start += 100) {
    const batch = ids.slice(start, start + 100);
    rows.push(...await pages(() => db.from(table).select('*').in(table === 'webstore_order_items' ? 'order_id' : table === 'so_item_decorations' ? 'so_item_id' : 'so_id', batch)));
  }
  return rows;
}

async function snapshot(db, storeId) {
  const { data: store, error: storeError } = await db.from('webstores')
    .select('id,name,slug,logo_url,primary_color,accent_color,decoration_mode').eq('id', storeId).eq('source', 'webstore').maybeSingle();
  if (storeError) throw storeError;
  if (!store) return null;
  const [products, orders] = await Promise.all([
    pages(() => db.from('webstore_products').select('id,product_id,sku,display_name,image_url,size_skus').eq('store_id', storeId).order('id')),
    pages(() => db.from('webstore_orders').select('id,store_id,so_id,status,created_at,buyer_name,order_number,backorder_of').eq('store_id', storeId).order('created_at')),
  ]);
  const live = orders.filter((o) => !/^(cancelled|canceled|pending_payment|refunded)$/i.test(String(o.status || '').trim()));
  const soIds = [...new Set(live.map((o) => o.so_id).filter(Boolean))];
  const [items, soItems, jobs, soArt] = await Promise.all([
    scopedChildren(db, 'webstore_order_items', live.map((o) => o.id)),
    scopedChildren(db, 'so_items', soIds),
    scopedChildren(db, 'so_jobs', soIds),
    scopedChildren(db, 'so_art_files', soIds),
  ]);
  const itemIds = soItems.map((i) => i.id);
  const decorations = await scopedChildren(db, 'so_item_decorations', itemIds);
  const salesOrders = [];
  for (let i = 0; i < soIds.length; i += 100) {
    const { data, error } = await db.from('sales_orders')
      .select('id,webstore_id,deco_pos,webstore_batch_no,webstore_batch_label,deleted_at')
      .in('id', soIds.slice(i, i + 100));
    if (error) throw error;
    salesOrders.push(...(data || []).filter((so) => !so.deleted_at && so.webstore_id === storeId));
  }
  // Art records can contain production files, but no financial or customer data.
  const validSoIds = new Set(salesOrders.map((so) => so.id));
  const productImages = [];
  const skus = [...new Set(soItems.filter((i) => validSoIds.has(i.so_id)).map((i) => i.sku).filter(Boolean))];
  for (let i = 0; i < skus.length; i += 100) {
    productImages.push(...await pages(() => db.from('products').select('sku,color,image_front_url').in('sku', skus.slice(i, i + 100))));
  }
  const art = soArt.filter((a) => validSoIds.has(a.so_id) && !a.archived).map((a) => ({
    id: a.id, name: a.name, preview_url: a.preview_url, mockup_files: a.mockup_files,
    item_mockups: a.item_mockups, files: (a.prod_files || a.files || []).map((f) => typeof f === 'string' ? f : { name: f.name, url: f.url }),
    so_id: a.so_id,
  }));
  return {
    store, products: products.map((p) => ({
      id: p.id, product_id: p.product_id, sku: p.sku, display_name: p.display_name,
      image_url: p.image_url, size_skus: p.size_skus,
    })), productImages, orders: live.map((o) => ({
      id: o.id, store_id: o.store_id, so_id: o.so_id, status: o.status,
      created_at: o.created_at, buyer_name: o.buyer_name,
      order_number: o.order_number, backorder_of: o.backorder_of,
    })),
    items: items.map((i) => ({
      id: i.id, order_id: i.order_id, product_id: i.product_id, sku: i.sku,
      name: i.name, color: i.color, size: i.size, qty: i.qty,
      player_name: i.player_name, player_number: i.player_number,
      line_status: i.line_status, short_status: i.short_status, short_qty: i.short_qty,
      is_bundle_parent: i.is_bundle_parent, cancelled_qty: i.cancelled_qty,
    })),
    soItems: soItems.filter((i) => validSoIds.has(i.so_id)).map((i) => ({
      id: i.id, so_id: i.so_id, product_id: i.product_id, sku: i.sku,
      name: i.name, custom_desc: i.custom_desc, color: i.color, sizes: i.sizes,
      _matchSkus: i._matchSkus,
    })),
    salesOrders,
    decorations: decorations.filter((d) => soItems.some((i) => validSoIds.has(i.so_id) && i.id === d.so_item_id)).map((d) => ({
      so_item_id: d.so_item_id, art_file_id: d.art_file_id, kind: d.kind,
      position: d.position, placement: d.placement, side: d.side,
      type: d.type, deco_type: d.deco_type, num_method: d.num_method,
      transfer_code: d.transfer_code, color_label: d.color_label,
    })),
    jobs: jobs.filter((j) => validSoIds.has(j.so_id)).map((j) => ({
      so_id: j.so_id, art_name: j.art_name, deco_type: j.deco_type,
      positions: j.positions, art_status: j.art_status, prod_status: j.prod_status,
      total_units: j.total_units, notes: j.notes,
    })), art,
    fetchedAt: new Date().toISOString(),
  };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'POST') return reply(405, { error: 'Method not allowed' });
  if ((event.body || '').length > 2048) return reply(413, { error: 'Request too large' });
  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return reply(400, { error: 'Invalid JSON' }); }
  const action = body.action;
  try {
    const db = getSupabaseAdmin();
    if (action === 'read') {
      if (!tokenOk(body.token)) return reply(404, { error: 'Report link unavailable' });
      const { data: share, error } = await db.from('webstore_production_shares').select('store_id,revoked_at').eq('token_hash', hash(body.token)).maybeSingle();
      if (error) throw error;
      if (!share || share.revoked_at) return reply(404, { error: 'Report link unavailable' });
      const data = await snapshot(db, share.store_id);
      return data ? reply(200, { data }) : reply(404, { error: 'Store unavailable' });
    }
    if (!['create', 'rotate', 'revoke'].includes(action)) return reply(400, { error: 'Unknown action' });
    const auth = await verifyUser(event);
    if (!auth.ok) return reply(auth.status, { error: auth.error });
    if (typeof body.storeId !== 'string' || !/^[a-f0-9-]{36}$/i.test(body.storeId)) return reply(400, { error: 'Invalid store' });
    const { data: store, error: storeError } = await db.from('webstores').select('id').eq('id', body.storeId).eq('source', 'webstore').maybeSingle();
    if (storeError) throw storeError;
    if (!store) return reply(404, { error: 'Store unavailable' });
    if (action === 'revoke') {
      const { error } = await db.from('webstore_production_shares').delete().eq('store_id', store.id);
      if (error) throw error;
      return reply(200, { ok: true });
    }
    // Reuse the store's link across staff sessions. The encrypted copy can only
    // be recovered by the server; rotate invalidates the old link explicitly.
    if (action === 'create') {
      const { data: previous, error } = await db.from('webstore_production_shares').select('token_encrypted').eq('store_id', store.id).maybeSingle();
      if (error) throw error;
      if (previous?.token_encrypted) {
        try { return reply(200, { token: decrypt(previous.token_encrypted), existing: true }); }
        catch { /* A rotated service key cannot decrypt the old link; issue a new one. */ }
      }
    }
    const token = crypto.randomBytes(32).toString('hex');
    const { error } = await db.from('webstore_production_shares').upsert({
      store_id: store.id, token_hash: hash(token), token_encrypted: encrypt(token), created_by: auth.userId,
      created_at: new Date().toISOString(), revoked_at: null,
    }, { onConflict: 'store_id' });
    if (error) throw error;
    return reply(200, { token });
  } catch (error) {
    console.error('[webstore-production-report]', error);
    return reply(500, { error: 'Could not load production report' });
  }
};

exports._test = { hash, tokenOk, snapshot };
