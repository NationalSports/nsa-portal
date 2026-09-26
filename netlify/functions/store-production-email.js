const { verifyUser } = require('./_shared');
const { _internals: packet } = require('./store-production-packet');
const { resolveDpos, dpoPdf } = require('./_packetDpo');
const checked = async query => { const {data,error} = await query; if(error) throw new Error(error.message); return data; };
exports.handler = async event => {
  const headers = {'Content-Type':'application/json','Cache-Control':'no-store'};
  const respond = (statusCode,body) => ({statusCode,headers,body:JSON.stringify(body)});
  if(event.httpMethod !== 'POST') return respond(405,{error:'Method not allowed'});
  const auth = await verifyUser(event);
  if(!auth.ok) return respond(auth.status || 401,{error:'Staff sign-in is required to email a decorator.'});
  try {
    const body = JSON.parse(event.body || '{}');
    if(!['options','prepare'].includes(body.action)) return respond(400,{error:'Unknown action'});
    // Authenticate separately even when the page itself was opened with a public token.
    const ctx = await packet.authorize(event,{store_id:body.store_id,scope_so_id:body.scope_so_id});
    const orders = await packet.all(() => ctx.admin.from('sales_orders').select('id,webstore_id,deco_pos').eq('webstore_id',ctx.storeId).order('id'));
    if(ctx.soId && !orders.some(o=>o.id===ctx.soId)) return respond(403,{error:'Sales order is outside this store'});
    const decorators = await packet.all(() => ctx.admin.from('deco_vendors').select('id,name,vendor_id').order('id'));
    const vendors = await packet.all(() => ctx.admin.from('vendors').select('id,name,contact_email').order('id'));
    const entries = resolveDpos(orders.filter(o=>!ctx.soId||o.id===ctx.soId),decorators,vendors);
    if(body.action==='options') return respond(200,{dpos:entries.map(({dp,so,...entry})=>entry)});
    const entry = entries.find(e=>e.id===body.dpo_id && e.soId===body.target_so_id);
    if(!entry) return respond(404,{error:'Choose a current DPO associated with this store'});
    entry.so.items = await packet.all(() => ctx.admin.from('so_items').select('item_index,sku,name,color,sizes').eq('so_id',entry.soId).order('id'));
    const content = await dpoPdf(entry);
    const shared = await packet.run(event,{action:'create_link',store_id:ctx.storeId,scope_so_id:entry.soId,label:`${entry.vendor} - ${entry.number}`});
    const url = `https://connect.nationalsportsapparel.com/production-packet#token=${shared.token}`;
    const actor = await checked(ctx.admin.from('team_members').select('name,email').eq('id',auth.teamMemberId).maybeSingle());
    const subject = `${entry.number} - Production packet - ${entry.soId}`;
    const text = `Hello,\n\nPlease use the production packet below for ${entry.soId}.\n\n${url}\n\nAssociated decoration purchase order: ${entry.number}\nDecorator: ${entry.vendor}\nThe DPO reference PDF is attached. The online packet includes the current quantities, artwork, mocks, player details and shared instructions.\n\nAnyone with this link can open it without signing in. The link expires in 90 days.\n\nThank you,\n${actor?.name || 'National Sports Apparel'}`;
    return respond(200,{to:entry.email,subject,text,url,dpo:entry.number,attachment:{name:entry.number.replace(/[^a-z0-9_-]/gi,'_')+'.pdf',content},replyTo:actor?.email?{email:actor.email,name:actor.name}:undefined});
  } catch(error) { return respond(error.status || 500,{error:error.status?error.message:'Could not prepare the decorator email. Retry or contact staff.'}); }
};
