const crypto = require('crypto');

const STORE_COLS = 'id,customer_id,name,slug,status,created_via,close_at,fundraise_goal,delivery_mode';
const ORDER_COLS = 'id,store_id,so_id,created_at,status,omg_order_number,order_number,buyer_name,payment_mode,fundraise_amt,total,shipped_at,tracking_number,carrier,ship_method,ship_address';
const ITEM_COLS = 'id,order_id,name,sku,size,qty,unit_price,line_status,missing_qty,backorder_eta,player_name,player_number,is_bundle_parent';
const ROSTER_FIELDS = new Set([
  'id', 'store_id', 'player_name', 'player_number', 'parent_email', 'ordered',
  'position', 'token', 'ordered_at', 'order_id', 'first_opened_at',
  'last_opened_at', 'open_count', 'invite_sent_at', 'invite_count',
  'reminder_sent_at',
]);

const cleanText = (value, max) => {
  const text = String(value == null ? '' : value).trim();
  return text ? text.slice(0, max) : null;
};

const normalizePosition = (value) => {
  const position = String(value || '').trim().toLowerCase();
  if (['gk', 'goalie', 'goalkeeper', 'keeper'].includes(position)) return 'gk';
  if (['field', 'fielder', 'outfield', 'player'].includes(position)) return 'field';
  return null;
};

const curateShipAddress = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return {
    name: cleanText(value.name, 200),
    city: cleanText(value.city, 120),
    state: cleanText(value.state, 80),
    zip: cleanText(value.zip, 20),
  };
};

const curateRosterRow = (row) => {
  const out = {};
  Object.entries(row || {}).forEach(([key, value]) => {
    if (ROSTER_FIELDS.has(key)) out[key] = value;
  });
  return out;
};

const rosterInsertRow = (storeId, value) => ({
  store_id: storeId,
  player_name: cleanText(value && value.player_name, 200),
  player_number: cleanText(value && value.player_number, 50),
  parent_email: cleanText(value && value.parent_email, 320),
  position: normalizePosition(value && value.position),
  token: crypto.randomBytes(16).toString('hex'),
  ordered: false,
});

async function assertStoreInFamily(admin, family, storeId) {
  const id = String(storeId || '').trim();
  if (!id) return { error: 'store_id required', status: 400 };
  const { data, error } = await admin.from('webstores')
    .select('id,customer_id,name,slug,primary_color').eq('id', id).maybeSingle();
  if (error) return { error: error.message, status: 500 };
  if (!data || !family.has(data.customer_id)) return { error: 'Store not found', status: 404 };
  return { store: data };
}

async function assertRosterRowInFamily(admin, family, rowId) {
  const id = String(rowId || '').trim();
  if (!id) return { error: 'player id required', status: 400 };
  const { data, error } = await admin.from('webstore_roster')
    .select('id,store_id').eq('id', id).maybeSingle();
  if (error) return { error: error.message, status: 500 };
  if (!data) return { error: 'Player not found', status: 404 };
  const owned = await assertStoreInFamily(admin, family, data.store_id);
  if (owned.error) return owned;
  return { row: data, store: owned.store };
}

async function fetchCoachWebstoreSnapshot(admin, family) {
  const customerIds = [...family];
  if (!customerIds.length) return { stores: [], orders: [], items: [], roster: [] };

  const stores = await fetchCoachWebstores(admin, family);
  const storeIds = (stores || []).map((store) => store.id);
  if (!storeIds.length) return { stores: [], orders: [], items: [], roster: [] };

  const [{ data: orders, error: orderError }, { data: roster, error: rosterError }] = await Promise.all([
    admin.from('webstore_orders').select(ORDER_COLS).in('store_id', storeIds).order('created_at', { ascending: false }),
    admin.from('webstore_roster').select('*').in('store_id', storeIds).order('player_name'),
  ]);
  if (orderError) throw new Error(orderError.message);
  if (rosterError) throw new Error(rosterError.message);

  const orderIds = (orders || []).map((order) => order.id);
  let items = [];
  if (orderIds.length) {
    const itemResult = await admin.from('webstore_order_items').select(ITEM_COLS).in('order_id', orderIds);
    if (itemResult.error) throw new Error(itemResult.error.message);
    items = itemResult.data || [];
  }

  return {
    stores: stores || [],
    orders: (orders || []).map((order) => ({ ...order, ship_address: curateShipAddress(order.ship_address) })),
    items,
    roster: (roster || []).map(curateRosterRow),
  };
}

async function fetchCoachWebstores(admin, family) {
  const customerIds = [...family];
  if (!customerIds.length) return [];
  const { data, error } = await admin.from('webstores')
    .select(STORE_COLS).in('customer_id', customerIds);
  if (error) throw new Error(error.message);
  return data || [];
}

module.exports = {
  assertRosterRowInFamily,
  assertStoreInFamily,
  curateRosterRow,
  curateShipAddress,
  fetchCoachWebstoreSnapshot,
  fetchCoachWebstores,
  normalizePosition,
  rosterInsertRow,
};
