// Serialize scratch database rows in the same nested shape consumed by the UI.
// Files are written only by the caller into its disposable test directory.
async function snapshot(db, soId, label, expectedStatus, expectedValue) {
  const order = (await db.query('select * from sales_orders where id=$1', [soId])).rows[0];
  const items = (await db.query('select * from so_items where so_id=$1 order by item_index', [soId])).rows;
  for (const item of items) {
    item.decorations = (await db.query('select * from so_item_decorations where so_item_id=$1 order by deco_index', [item.id])).rows;
    for (const [field, table] of [['pick_lines','so_item_pick_lines'],['po_lines','so_item_po_lines']]) {
      const exists = (await db.query('select to_regclass($1) name',[table])).rows[0].name;
      item[field] = exists ? (await db.query(`select * from ${table} where so_item_id=$1`,[item.id])).rows.map(r=>({...r,...r.sizes})) : [];
    }
    for (const key of ['unit_sell','nsa_cost','est_qty']) if (item[key] != null) item[key] = Number(item[key]);
    for (const deco of item.decorations) for (const key of ['sell','sell_each','cost','cost_each','qty','stitches']) if (deco[key] != null) deco[key] = Number(deco[key]);
  }
  order.items = items;
  order.jobs = (await db.query('select * from so_jobs where so_id=$1 order by id',[soId])).rows;
  const artTable = (await db.query("select to_regclass('so_art_files') name")).rows[0].name;
  order.art_files = artTable ? (await db.query('select * from so_art_files where so_id=$1',[soId])).rows : [];
  return { label, expectedStatus, expectedValue, order,
    stores: (await db.query('select id,name,org_type,source from webstores where id=$1',[order.webstore_id])).rows,
    customers: (await db.query('select id,name from customers where id=$1',[order.customer_id])).rows };
}
module.exports = { snapshot };
