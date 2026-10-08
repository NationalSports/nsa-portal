// Account context is background reference, never evidence of a new commitment.
async function accountContextFor(admin, customerId) {
  if (!customerId) return { accountContext: null };
  const results = await Promise.all([
    admin.from('estimates').select('id,status,memo').eq('customer_id',customerId).in('status',['draft','open','sent','approved']).order('id',{ascending:false}).limit(8),
    admin.from('sales_orders').select('id,status,memo,expected_date').eq('customer_id',customerId).order('id',{ascending:false}).limit(12),
  ]);
  if (results.some(r=>r.error)) throw new Error('Could not load account reference context. Retry when account data is available.');
  const [quotes,orders]=results.map(r=>r.data||[]);
  const items = await Promise.all([
    quotes.length ? admin.from('estimate_items').select('estimate_id,sku,name,brand,color,sizes').in('estimate_id',quotes.map(r=>r.id)).limit(80) : {data:[]},
    orders.length ? admin.from('so_items').select('so_id,sku,name,brand,color,sizes').in('so_id',orders.map(r=>r.id)).limit(100) : {data:[]},
  ]);
  if(items.some(r=>r.error)) throw new Error('Could not load account garment history.');
  const item=r=>({...r,name:String(r.name||'').slice(0,120),sizes:Object.fromEntries(Object.entries(r.sizes||{}).filter(([k,v])=>typeof v==='number'&&/^[A-Z0-9-]{1,8}$/i.test(k)).slice(0,20))});
  const clean=r=>({...r,memo:String(r.memo||'').slice(0,300)});
  return {accountContext:{quotes:quotes.map(clean),orders:orders.map(clean),quoteItems:(items[0].data||[]).map(item),orderItems:(items[1].data||[]).map(item)}};
}
module.exports={accountContextFor};
