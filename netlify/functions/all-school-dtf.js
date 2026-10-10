const {corsHeaders,getSupabaseAdmin,verifyUser} = require('./_shared');
const {REQUESTS,BATCHES,recordAllSchoolDtfForSo,prepareStoreBatches,sendBatch} = require('./_allSchoolDtf');
const respond = (statusCode,body) => ({statusCode,headers:{...corsHeaders(),'Cache-Control':'no-store'},body:JSON.stringify(body)});

async function sweepAllSchoolDtf(admin) {
  const results = [];
  const start = Date.now();
  const cursorRes = await admin.from('all_school_dtf_scan_state').select('*').eq('id','orders').single();
  if (cursorRes.error) throw new Error(cursorRes.error.message);
  let cursor = cursorRes.data;
  if (!cursor.upper_order_id) {
    const upper = await admin.from('webstore_orders').select('id').eq('order_source','all_school').in('status',['paid','batched']).not('so_id','is',null).order('id',{ascending:false}).limit(1);
    if (upper.error) throw new Error(upper.error.message);
    cursor = {...cursor,upper_order_id:upper.data?.[0]?.id || null,last_order_id:null};
  }
  if (cursor.upper_order_id) {
    let query = admin.from('webstore_orders').select('id,store_id,so_id').eq('order_source','all_school').in('status',['paid','batched']).not('so_id','is',null).lte('id',cursor.upper_order_id).order('id').limit(25);
    if (cursor.last_order_id) query = query.gt('id',cursor.last_order_id);
    const orders = await query;
    if (orders.error) throw new Error(orders.error.message);
    let processed = 0;
    for (const order of orders.data || []) {
      if (Date.now()-start>18000) break;
      try {
        await recordAllSchoolDtfForSo(admin,order.so_id);
        const store = await admin.from('webstores').select('all_school_settings').eq('id',order.store_id).maybeSingle();
        if (store.error) throw new Error(store.error.message);
        if (store.data?.all_school_settings?.dtf?.auto_send === true) await prepareStoreBatches(admin,order.store_id);
      } catch (e) { results.push({order_id:order.id,error:e.message}); }
      cursor.last_order_id=order.id;processed++;
    }
    if (processed === (orders.data || []).length && processed<25) cursor={...cursor,last_order_id:null,upper_order_id:null};
    const saved = await admin.from('all_school_dtf_scan_state').update({last_order_id:cursor.last_order_id,upper_order_id:cursor.upper_order_id,updated_at:new Date().toISOString()}).eq('id','orders');
    if (saved.error) throw new Error(saved.error.message);
  }
  // Query only stores that currently authorize auto-send; disabled queues cannot
  // occupy a global cap and starve another school's ready supplier batches.
  if (process.env.ALL_SCHOOL_DTF_SEND_ENABLED === 'true' && Date.now()-start<18000) {
    const candidates = await admin.rpc('all_school_dtf_send_candidates');
    if (candidates.error) throw new Error(candidates.error.message);
    for (const batch of candidates.data || []) {
      if (Date.now()-start>18000) break;
      try { results.push({id:batch.id,...await sendBatch(admin,batch)}); }
      catch (e) { results.push({id:batch.id,error:e.message}); }
    }
  }
  return {ok:true,results};
}

exports.handler = async event => {
  if (event && event.httpMethod === 'OPTIONS') return respond(200,{});
  const scheduled = !event || !event.httpMethod;
  try {
    const admin = getSupabaseAdmin();
    if (scheduled) return respond(200,await sweepAllSchoolDtf(admin));
    if (event.httpMethod !== 'POST') return respond(405,{error:'Method not allowed'});
    const auth = await verifyUser(event, ["webstores"]);
    if (!auth.ok) return respond(auth.status || 401,{error:auth.error || 'Unauthorized'});
    const body = JSON.parse(event.body || '{}');
    if (!body.store_id) return respond(400,{error:'store_id required'});
    const storeRes = await admin.from('webstores').select('id,org_type').eq('id',body.store_id).maybeSingle();
    if (storeRes.error) throw new Error(storeRes.error.message);
    if (!storeRes.data || storeRes.data.org_type !== 'all_school') return respond(404,{error:'All-school store not found'});
    if (body.action === 'list') {
      const reads = await Promise.all([
        admin.from(REQUESTS).select('*').eq('store_id',body.store_id).order('created_at',{ascending:false}).limit(200),
        admin.from(BATCHES).select('*').eq('store_id',body.store_id).order('created_at',{ascending:false}).limit(100),
      ]);
      for (const r of reads) if (r.error) throw new Error(r.error.message);
      return respond(200,{requests:reads[0].data || [],batches:reads[1].data || [],sending_enabled:process.env.ALL_SCHOOL_DTF_SEND_ENABLED === 'true'});
    }
    if (body.action === 'prepare' || body.action === 'refresh') {
      const orders = await admin.from('webstore_orders').select('so_id').eq('store_id',body.store_id).in('status',['paid','batched']).not('so_id','is',null).limit(200);
      if (orders.error) throw new Error(orders.error.message);
      for (const soId of [...new Set((orders.data || []).map(o => o.so_id))]) await recordAllSchoolDtfForSo(admin,soId,{refreshBlocked:body.action === 'refresh'});
      return respond(200,body.action === 'prepare' ? await prepareStoreBatches(admin,body.store_id) : {ok:true});
    }
    if (!['send','receive','retry'].includes(body.action)) return respond(400,{error:'Unknown action'});
    const batchRes = await admin.from(BATCHES).select('*').eq('id',body.batch_id).eq('store_id',body.store_id).maybeSingle();
    if (batchRes.error) throw new Error(batchRes.error.message);
    if (!batchRes.data) return respond(404,{error:'Batch not found'});
    if (body.action === 'retry') {
      const reset = await admin.from(BATCHES).update({status:'queued',error:null}).eq('id',body.batch_id).eq('store_id',body.store_id).eq('status','blocked').is('message_id',null).select('id');
      if (reset.error) throw new Error(reset.error.message);
      return (reset.data || []).length ? respond(200,{ok:true}) : respond(409,{error:'Only a confirmed rejected or unsent blocked batch can be retried. Check uncertain delivery in the sending account.'});
    }
    if (body.action === 'send') return respond(200,await sendBatch(admin,batchRes.data));
    const received = await admin.rpc('receive_all_school_dtf_batch',{p_batch_id:body.batch_id,p_actor:auth.teamMemberId || 'staff',p_bin:String(body.bin || '').trim()});
    if (received.error) return respond(409,{error:received.error.message});
    return respond(200,received.data);
  } catch (e) { return respond(500,{error:e.message || 'DTF action failed'}); }
};
exports.sweepAllSchoolDtf = sweepAllSchoolDtf;
