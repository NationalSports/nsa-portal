const { _internals: packet } = require('./store-production-packet');
const { resolveDpos, attachDpoContext, dpoPdf } = require('./_packetDpo');
const { scopedSalesOrders } = require('./_packetScope');
exports.handler = async event => {
  const headers = {'Content-Type':'application/json','Cache-Control':'no-store','Referrer-Policy':'no-referrer'};
  const respond = (statusCode,body) => ({statusCode,headers,body:JSON.stringify(body)});
  if(event.httpMethod !== 'POST') return respond(405,{error:'Method not allowed'});
  try {
    const body = JSON.parse(event.body || '{}');
    if(!['options','download'].includes(body.action)) return respond(400,{error:'Unknown action'});
    // A valid recipient token is the access grant; its stored scope is authoritative.
    const ctx = await packet.authorize(event,{token:body.token,store_id:body.store_id,scope_so_id:body.scope_so_id});
    if(body.action==='options') return respond(200,await attachDpoContext(ctx,null,{}));
    const orders = await packet.all(() => scopedSalesOrders(ctx,'id,webstore_id,status,deco_pos').order('id'));
    if(ctx.soId && !orders.some(o=>o.id===ctx.soId)) return respond(403,{error:ctx.storeId?'Sales order is outside this store':'Sales order not found'});
    const decorators = await packet.all(() => ctx.admin.from('deco_vendors').select('id,name,vendor_id').order('id'));
    const vendors = await packet.all(() => ctx.admin.from('vendors').select('id,name,contact_email').order('id'));
    const entries = resolveDpos(orders.filter(o=>!ctx.soId||o.id===ctx.soId),decorators,vendors);
    const entry = entries.find(e=>e.id===body.dpo_id && e.soId===(body.dpo_so_id || body.target_so_id));
    if(!entry) return respond(404,{error:'Choose a current DPO associated with this store'});
    entry.so.items = await packet.all(() => ctx.admin.from('so_items').select('item_index,sku,name,color,sizes').eq('so_id',entry.soId).order('item_index'));
    const content = await dpoPdf(entry);
    return respond(200,{attachment:{name:entry.number.replace(/[^a-z0-9_-]/gi,'_')+'.pdf',content}});
  } catch(error) { return respond(error.status || 500,{error:error.status?error.message:'Could not load the DPO reference. Please retry.'}); }
};
