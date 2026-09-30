jest.mock('../../netlify/functions/_webstoreNotifications',()=>({escapeHtml:v=>String(v??'').replace(/</g,'&lt;'),sendBrevoEmail:jest.fn()}));
const {normalizeShipment,recordShipment,drainShipmentEmails}=require('../../netlify/functions/_packetShipping');
const {sendBrevoEmail}=require('../../netlify/functions/_webstoreNotifications');
const packet={fingerprint:'current',salesOrders:[{id:'SO-1'}],dpos:[{id:'d1',soId:'SO-1',number:'DPO-1',coveredQuantity:10}]};
const body={target_so_id:'SO-1',shipment_dpo_id:'d1',carrier:'ups',tracking_number:'1Z123456',ship_date:'2026-01-01',quantity:4,destination:'customer',fingerprint:'current'};
test('partial customer shipment uses canonical fields and normalized idempotency key',()=>{
 const s=normalizeShipment(body,packet);
 expect(s).toMatchObject({fulfillment:true,quantity:4,shipment_scope:'customer',tracking_number:'1Z123456'});
 expect(normalizeShipment({...body,tracking_number:'1z 123456'},packet).id).toBe(s.id);
 expect(normalizeShipment({...body,destination:'nsa'},packet)).toMatchObject({fulfillment:false,shipment_scope:'deco_transfer'});
});
test.each([{target_so_id:'SO-2'},{shipment_dpo_id:'d2'},{quantity:0},{quantity:11},{quantity:1.2},{carrier:'javascript:'},{tracking_number:'<script>'},{ship_date:'2026-02-30'},{destination:''}])('rejects invalid shipment %j',patch=>expect(()=>normalizeShipment({...body,...patch},packet)).toThrow());
test('DPO-scoped pages cannot submit another DPO',()=>expect(()=>normalizeShipment(body,{...packet,dpo:{id:'d2',soId:'SO-1'}})).toThrow());
test('stale or issued packets never invoke the transaction',async()=>{
 const ctx={admin:{rpc:jest.fn()}};
 await expect(recordShipment(ctx,{...body,fingerprint:'old'},packet)).rejects.toThrow('changed');
 await expect(recordShipment(ctx,{...body,revision_id:'r1'},packet)).rejects.toThrow('live');
 expect(ctx.admin.rpc).not.toHaveBeenCalled();
});
test('recipient is derived by transaction, not supplied by public request',async()=>{
 const rpc=jest.fn().mockResolvedValue({data:{shipmentId:'saved',emailStatus:'queued'}});
 await recordShipment({admin:{rpc},storeId:'store',link:{id:'link'},soVersions:{'SO-1':9}}, {...body,rep_id:'attacker',email:'attacker@example.com'},packet);
 expect(rpc.mock.calls[0][1]).toMatchObject({p_store_id:'store',p_link_id:'link',p_actor_id:null,p_expected_version:9});
 expect(JSON.stringify(rpc.mock.calls[0][1])).not.toContain('attacker');
});
function mailDb(rep={email:'rep@example.com',name:'Rep'}) {
 const patches=[];
 const db={rpc:jest.fn().mockResolvedValue({data:[{id:'queue-id',rep_id:'rep',so_id:'SO-1',attempts:1,shipment:normalizeShipment(body,packet)}]}),from:table=>{
  const q={select:()=>q,eq:()=>q,maybeSingle:async()=>({data:rep}),update:p=>{patches.push(p);return q;},then:resolve=>Promise.resolve({error:null}).then(resolve)};return q;
 }};return {db,patches};
}
test('email goes only to assigned rep and contains SO, DPO and tracking',async()=>{
 sendBrevoEmail.mockResolvedValue('provider-id');const {db,patches}=mailDb();
 expect(await drainShipmentEmails(db)).toEqual({sent:1,failed:0});
 const [payload,key]=sendBrevoEmail.mock.calls.slice(-1)[0];expect(payload.to).toEqual([{email:'rep@example.com',name:'Rep'}]);
 expect(payload.htmlContent).toContain('DPO-1');expect(payload.htmlContent).toContain('1Z123456');expect(key).toBe('queue-id');expect(patches[0].status).toBe('sent');
});
test('email failure retains retry obligation without changing shipment',async()=>{
 sendBrevoEmail.mockRejectedValue(new Error('Provider offline'));const {db,patches}=mailDb();
 expect(await drainShipmentEmails(db)).toEqual({sent:0,failed:1});expect(patches[0]).toMatchObject({status:'pending',last_error:'Provider offline'});
});
test('missing rep email is retained for retry',async()=>{const {db,patches}=mailDb({name:'Rep'});await drainShipmentEmails(db);expect(patches[0].status).toBe('pending');});
