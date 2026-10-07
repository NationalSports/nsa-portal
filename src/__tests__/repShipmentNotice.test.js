/** @jest-environment node */
const { notifyShipmentRep, drainRepShipmentEmails } = require('../../netlify/functions/_repShipmentNotice');
let mockDb;
let mockAuth=true;
jest.mock('../../netlify/functions/_shared',()=>({
  corsHeaders:()=>({}),verifyUser:async()=>mockAuth?{ok:true,admin:mockDb}:{ok:false,status:401,error:'Sign in'},
}));
const {handler}=require('../../netlify/functions/so-shipment-rep-notify');
let rows;
function db() {
  return {
    async rpc(_, {p_id}) {
      const claim=rows.so_rep_shipment_outbox.filter(r=>(!p_id||r.id===p_id)&&r.status==='pending'&&(!r.available_at||Date.parse(r.available_at)<=Date.now())).slice(0,3);
      claim.forEach(r=>{r.status='processing';r.attempts++});
      return {data:claim.map(r=>({...r})),error:null};
    },
    from(table) {
      let filters=[],write=null;
      const matching=()=>rows[table].filter(r=>filters.every(([k,v])=>r[k]===v));
      const q={select:()=>q,eq:(k,v)=>{filters.push([k,v]);return q},
        upsert:(value)=>{write=()=>{if(!rows[table].some(r=>r.id===value.id))rows[table].push({...value,status:'pending',attempts:0})};return q},
        update:value=>{write=()=>matching().forEach(r=>Object.assign(r,value));return q},
        maybeSingle:async()=>({data:matching()[0]||null,error:null}),single:async()=>({data:matching()[0],error:null}),
        then(resolve,reject){if(write)write();return Promise.resolve({data:matching(),error:null}).then(resolve,reject)},
      };return q;
    },
  };
}
beforeEach(()=>{
  rows={
    sales_orders:[{id:'SO-1',status:'complete',customer_id:'c1',rep_id:'order-rep',memo:'Team <special>',_shipped:true,_shipments:[
      {id:'pickup',cleared:true,clear_memo:'Picked up by rep',ship_date:'10/5/2026',items:[{name:'Tee',sizes:{M:12}}]},
      {id:'transfer',shipment_scope:'deco_transfer',fulfillment:false,items:[{name:'Do not announce'}]},
    ]}],
    customers:[{id:'c1',name:'Team',primary_rep_id:'customer-rep'}],
    team_members:[{id:'order-rep',name:'Assigned Rep',email:'rep@example.com'},{id:'customer-rep',name:'Customer Rep',email:'other@example.com'}],
    so_rep_shipment_outbox:[],
  };mockDb=db();mockAuth=true;process.env.BREVO_API_KEY='fake';
  global.fetch=jest.fn(async()=>({ok:true,status:201,json:async()=>({messageId:'message-1'})}));
});
afterEach(()=>{delete global.fetch});
const call=body=>handler({httpMethod:'POST',headers:{},body:JSON.stringify(body)});

test('closed SO pickup without tracking sends only to the SO rep and excludes transfers',async()=>{
  const result=await notifyShipmentRep(mockDb,{soId:'SO-1'});
  expect(result).toMatchObject({status:'sent',to:'rep@example.com'});
  const payload=JSON.parse(fetch.mock.calls[0][1].body);
  expect(payload.to).toEqual([{name:'Assigned Rep',email:'rep@example.com'}]);
  expect(payload.htmlContent).toContain('Tracking not recorded');
  expect(payload.htmlContent).toContain('Picked up by rep');
  expect(payload.htmlContent).toContain('Team &lt;special&gt;');
  expect(payload.htmlContent).not.toContain('Do not announce');
  expect(rows.sales_orders[0]).not.toHaveProperty('_version');
});
test('preview sends nothing; caller cannot replace recipient or email content',async()=>{
  const preview=await call({soId:'SO-1',preview:true,to:'outsider@example.com',html:'injected'});
  expect(JSON.parse(preview.body).to).toBe('rep@example.com');expect(fetch).not.toHaveBeenCalled();
  await call({soId:'SO-1',to:'outsider@example.com',html:'injected'});
  expect(JSON.parse(fetch.mock.calls[0][1].body).to[0].email).toBe('rep@example.com');
});
test('requires signed-in staff',async()=>{
  mockAuth=false;expect((await call({soId:'SO-1'})).statusCode).toBe(401);expect(fetch).not.toHaveBeenCalled();
});
test('uses customer rep only when order has no rep override',async()=>{
  rows.sales_orders[0].rep_id=null;
  expect((await notifyShipmentRep(mockDb,{soId:'SO-1',preview:true})).to).toBe('other@example.com');
});
test('missing rep and unsaved or transfer shipment fail without sending',async()=>{
  await expect(notifyShipmentRep(mockDb,{soId:'SO-1',shipmentIds:['missing']})).rejects.toThrow(/saved/);
  await expect(notifyShipmentRep(mockDb,{soId:'SO-1',shipmentIds:['transfer']})).rejects.toThrow(/saved/);
  rows.team_members[0].email='';
  await expect(notifyShipmentRep(mockDb,{soId:'SO-1'})).rejects.toThrow(/email/);
  expect(fetch).not.toHaveBeenCalled();
});
test('repeated button presses cannot duplicate an already delivered update',async()=>{
  await notifyShipmentRep(mockDb,{soId:'SO-1'});
  await notifyShipmentRep(mockDb,{soId:'SO-1'});
  expect(fetch).toHaveBeenCalledTimes(1);expect(rows.so_rep_shipment_outbox).toHaveLength(1);
});
test('provider failure stays queued; later retry uses same idempotency key and succeeds',async()=>{
  fetch.mockImplementationOnce(async()=>({ok:false,status:503,json:async()=>({message:'Unavailable'})}));
  expect((await notifyShipmentRep(mockDb,{soId:'SO-1'})).status).toBe('queued');
  expect(rows.so_rep_shipment_outbox[0]).toMatchObject({status:'pending',attempts:1});
  rows.so_rep_shipment_outbox[0].available_at='2000-01-01';
  expect(await drainRepShipmentEmails(mockDb)).toEqual({sent:1,failed:0});
  expect(JSON.parse(fetch.mock.calls[0][1].body).headers.idempotencyKey).toBe(JSON.parse(fetch.mock.calls[1][1].body).headers.idempotencyKey);
  expect(rows.so_rep_shipment_outbox[0]).toMatchObject({status:'sent',attempts:2});
});

test('a provider duplicate-key response records success instead of retrying until key expiry',async()=>{
  fetch.mockImplementationOnce(async()=>({ok:false,status:400,json:async()=>({code:'duplicate_parameter'})}));
  expect((await notifyShipmentRep(mockDb,{soId:'SO-1'})).status).toBe('sent');
  expect(rows.so_rep_shipment_outbox[0].status).toBe('sent');
});

test('SO-2173 shape resolves creator when SO and customer have no explicit rep',async()=>{
  rows.sales_orders[0].rep_id=null;
  rows.sales_orders[0].created_by='order-rep';
  rows.customers[0].primary_rep_id=null;
  expect((await notifyShipmentRep(mockDb,{soId:'SO-1',preview:true})).to).toBe('rep@example.com');
});
test('customer assignment takes precedence over the order creator',async()=>{
  rows.sales_orders[0].rep_id=null;
  rows.sales_orders[0].created_by='order-rep';
  expect((await notifyShipmentRep(mockDb,{soId:'SO-1',preview:true})).to).toBe('other@example.com');
});
test('a genuinely unassigned order fails clearly without sending',async()=>{
  rows.sales_orders[0].rep_id=null;
  rows.customers[0].primary_rep_id=null;
  await expect(notifyShipmentRep(mockDb,{soId:'SO-1'})).rejects.toThrow(/Assign a rep/);
  expect(fetch).not.toHaveBeenCalled();
});
