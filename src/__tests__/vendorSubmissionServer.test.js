jest.mock('../../netlify/functions/_shared', () => ({
  getSupabaseAdmin: jest.fn(), verifyUser: jest.fn(), verifyUserOrInternal: jest.fn(),
}));
const shared = require('../../netlify/functions/_shared');
const { submissionSources, reserveSubmission } = require('../../netlify/functions/_vendorSubmissionGuard');
const handlers = {
  sanmar: require('../../netlify/functions/sanmar-proxy').handler,
  sss: require('../../netlify/functions/ss-proxy').handler,
  momentec: require('../../netlify/functions/momentec-proxy').handler,
};
const source = { sourceSO:'SO-2757',sourcePO:'PO 60232 SERF',sourceBatchId:'BPO-1',sourceSku:'ST350',sourceColor:'Black',size:'M',quantity:28,partId:'609423',sku:'609423' };
function event(vendor, extras={}) {
  const payload = vendor==='sanmar' ? {PO:{orderNumber:'NSA 4901',lineItems:[{partId:'609423',quantity:28}]}}
    : vendor==='sss' ? {poNumber:'NSA 4901',testOrder:false,lines:[{identifier:'609423',qty:28}]}
      : {poNum:'NSA 4901',items:[{sku:'609423',quantity:'28'}]};
  return {httpMethod:'POST',headers:{},queryStringParameters: vendor==='sanmar' ? {service:'po',action:'sendPO',env:'prod'}
    : vendor==='sss' ? {path:'/orders'} : {service:'order',env:'prod'},body:JSON.stringify({...payload,_portalSources:[source],...extras})};
}
function response(vendor) {
  const body = vendor==='sanmar' ? '<sendPOResponse><transactionId>TX-1</transactionId></sendPOResponse>'
    : vendor==='sss' ? JSON.stringify([{orderNumber:'SS-1'}]) : JSON.stringify({orderId:'MT-1'});
  return {ok:true,status:200,text:async()=>body,headers:{get:()=>null}};
}
let db;
beforeEach(() => {
  jest.clearAllMocks();
  Object.assign(process.env,{SANMAR_USERNAME:'test',SANMAR_PASSWORD:'test',SS_ACCOUNT_NUMBER:'test',SS_API_KEY:'test',MOMENTEC_LOGON_ID:'test',MOMENTEC_PASSWORD:'test'});
  db={rpc:jest.fn(async name => name==='reserve_vendor_api_submission' ? {data:{id:'reservation',po_number:'NSA 4901'}} : {data:null})};
  shared.getSupabaseAdmin.mockReturnValue(db);
  shared.verifyUser.mockResolvedValue({ok:true,userId:'user-a',admin:db});
  shared.verifyUserOrInternal.mockResolvedValue({ok:true,userId:'user-a',admin:db});
  global.fetch=jest.fn();
});
for(const vendor of Object.keys(handlers)) {
  describe(vendor+' live submission', () => {
    test('reserves before calling supplier, saves acknowledgement, strips metadata',async()=>{
      global.fetch.mockImplementation(async()=>{
        expect(db.rpc.mock.calls[0][0]).toBe('reserve_vendor_api_submission');
        return response(vendor);
      });
      const result=await handlers[vendor](event(vendor));
      expect(result.statusCode).toBe(200);
      expect(global.fetch).toHaveBeenCalledTimes(1);
      expect(global.fetch.mock.calls[0][1].body).not.toContain('_portalSources');
      expect(db.rpc.mock.calls[1]).toEqual(['finish_vendor_api_submission',expect.objectContaining({p_status:'accepted'})]);
    });
    test('blocks another client before supplier call',async()=>{
      db.rpc.mockResolvedValue({error:{message:'DUPLICATE_VENDOR_ORDER: already ordered under NSA 4691'}});
      const result=await handlers[vendor](event(vendor));
      expect(result.statusCode).toBe(409);
      expect(global.fetch).not.toHaveBeenCalled();
    });
    test('old tab missing source data fails closed',async()=>{
      const result=await handlers[vendor](event(vendor,{_portalSources:undefined}));
      expect(result.statusCode).toBe(400);
      expect(global.fetch).not.toHaveBeenCalled();
    });
    test('database outage never falls back to unguarded ordering',async()=>{
      db.rpc.mockResolvedValue({error:{message:'unavailable'}});
      const result=await handlers[vendor](event(vendor));
      expect(result.statusCode).toBe(503);
      expect(global.fetch).not.toHaveBeenCalled();
    });
    test('network timeout holds the reservation and tells user to verify',async()=>{
      global.fetch.mockRejectedValue(new Error('timeout'));
      const result=await handlers[vendor](event(vendor));
      expect(result.statusCode).toBe(500);
      expect(JSON.parse(result.body).error).toMatch(/blocked against resubmission/);
      expect(db.rpc.mock.calls[1][1].p_status).toBe('uncertain');
    });
    test('receipt write failure does not invite retry of accepted order',async()=>{
      db.rpc.mockImplementation(async name=>name==='reserve_vendor_api_submission'?{data:{id:'reservation',po_number:'NSA 4901'}}:{error:{message:'receipt unavailable'}});
      global.fetch.mockResolvedValue(response(vendor));
      expect((await handlers[vendor](event(vendor))).statusCode).toBe(200);
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });
    test('missing supplier acknowledgement stays blocked',async()=>{
      global.fetch.mockResolvedValue({ok:true,status:200,text:async()=>'{}',headers:{get:()=>null}});
      const result=await handlers[vendor](event(vendor));
      expect(JSON.parse(result.body).error).toMatch(/blocked against resubmission/);
      expect(db.rpc.mock.calls[1][1].p_status).toBe('uncertain');
    });
    test('two concurrent server instances send only one supplier request',async()=>{
      let claimed=false;
      db.rpc.mockImplementation(async name=>{
        if(name!=='reserve_vendor_api_submission')return {data:null};
        if(claimed)return {error:{message:'DUPLICATE_VENDOR_ORDER: reserved'}};
        claimed=true; return {data:{id:'reservation',po_number:'NSA 4901'}};
      });
      global.fetch.mockResolvedValue(response(vendor));
      const results=await Promise.all([handlers[vendor](event(vendor)),handlers[vendor](event(vendor))]);
      expect(results.map(r=>r.statusCode).sort()).toEqual([200,409]);
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });
  });
}
test('source quantities must match supplier quantities per SKU, not just totals',()=>{
  expect(()=>submissionSources([source],[{sku:'wrong-item',qty:28}])).toThrow(/do not match/);
  expect(()=>submissionSources([source],[{sku:'609423',qty:56}])).toThrow(/do not match/);
});
test('cross-SO merges retain separate source allocations',()=>{
  expect(submissionSources([source,{...source,sourceSO:'SO-2'}],[{sku:'609423',qty:56}]).map(s=>s.so_id)).toEqual(['SO-2757','SO-2']);
});
test('manual vendor size substitution preserves the original source size',()=>{
  expect(submissionSources([{...source,size:'XL',sourceSize:'M'}],[{sku:'609423',qty:28}])[0].size).toBe('M');
});
test('S&S endpoint casing, encoded routes, trailing slash, and query cannot bypass guard',async()=>{
  for(const path of ['/Orders/','/%6frders','/orders?foo=bar']){
    const e=event('sss',{_portalSources:undefined});e.queryStringParameters.path=path;
    expect((await handlers.sss(e)).statusCode).toBe(400);
  }
  expect(global.fetch).not.toHaveBeenCalled();
});
test('S&S safe test mode does not reserve production demand',async()=>{
  global.fetch.mockResolvedValue(response('sss'));
  expect((await handlers.sss(event('sss',{testOrder:true}))).statusCode).toBe(200);
  expect(db.rpc).not.toHaveBeenCalled();
});
test('SanMar test and Momentec stage never reserve production demand',async()=>{
  for(const vendor of ['sanmar','momentec']){
    const e=event(vendor);e.queryStringParameters.env=vendor==='sanmar'?'test':'stage';
    global.fetch.mockResolvedValue(response(vendor));
    expect((await handlers[vendor](e)).statusCode).toBe(200);
  }
  expect(db.rpc).not.toHaveBeenCalled();
});
test('S&S read-only order lookup is unaffected',async()=>{
  global.fetch.mockResolvedValue(response('sss'));
  const e=event('sss');e.httpMethod='GET';e.body=null;
  expect((await handlers.sss(e)).statusCode).toBe(200);
  expect(db.rpc).not.toHaveBeenCalled();
});
test('reserve failure without receipt fails closed',async()=>{
  db.rpc.mockResolvedValue({data:null});
  await expect(reserveSubmission({vendor:'sanmar',poNumber:'NSA 4901',lines:[source],vendorLines:[{sku:'609423',qty:28}]})).rejects.toMatchObject({statusCode:503});
});

test('standalone PO sources do not require a batch queue id',()=>{
  expect(submissionSources([{...source,sourceBatchId:undefined}],[{sku:'609423',qty:28}])[0].queue_id).toBe('');
});
