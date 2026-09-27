/** @jest-environment node */
jest.mock('../../netlify/functions/store-production-packet',()=>({_internals:{authorize:jest.fn(),all:jest.fn(),run:jest.fn()}}));
const {_internals:packet}=require('../../netlify/functions/store-production-packet');
const {handler}=require('../../netlify/functions/store-production-email');
const {resolveDpos,attachDpoContext,dpoPdf}=require('../../netlify/functions/_packetDpo');
const {dpoShareUrl}=require('../productionPacket/dpoScope');
const orders=[{id:'SO-2649',deco_pos:[{id:'dp1',po_id:'DPO 60006',vendor:'Silver Screen',deco_vendor_id:'dv1',item_idxs:[0],qty:2,unit_cost:3}]}];
const decorators=[{id:'dv1',name:'Silver Screen',vendor_id:'v1'}];
const vendors=[{id:'v1',contact_email:'trinity.lyle@silverscreenprinting.com'}];
const invoke=body=>handler({httpMethod:'POST',body:JSON.stringify(body)});
beforeEach(()=>jest.resetAllMocks());
test('resolves recipient through selected DPO decorator, not a hardcoded store email',()=>{
 expect(resolveDpos(orders,decorators,vendors)[0]).toMatchObject({soId:'SO-2649',email:vendors[0].contact_email,number:'DPO 60006'});
 expect(resolveDpos(orders,decorators,[])[0].email).toBe('');
 expect(resolveDpos([{...orders[0],deco_pos:[{...orders[0].deco_pos[0],status:'cancelled'}]}],decorators,vendors)).toEqual([]);
 expect(resolveDpos([{...orders[0],status:'canceled'}],decorators,vendors)).toEqual([]);
});
test('expired or revoked tokens cannot retrieve DPO data',async()=>{
 packet.authorize.mockRejectedValue(Object.assign(new Error('Link is invalid or expired'),{status:403}));
 expect((await invoke({action:'options',token:'a'.repeat(64)})).statusCode).toBe(403);
 expect(packet.all).not.toHaveBeenCalled();
});
function setup(){
 const q={select:()=>q,eq:()=>q,maybeSingle:async()=>({data:{name:'Staff',email:'staff@example.com'}})};
 packet.authorize.mockResolvedValue({admin:{from:()=>q},storeId:'store'});
 packet.all.mockResolvedValueOnce(orders).mockResolvedValueOnce(decorators).mockResolvedValueOnce(vendors);
}
test('rejects a DPO from another SO before creating a share link',async()=>{
 setup();const response=await invoke({action:'download',store_id:'store',dpo_id:'dp1',target_so_id:'other'});
 expect(response.statusCode).toBe(404);expect(packet.run).not.toHaveBeenCalled();
});
test('valid recipient token downloads its associated DPO without staff login or creating a new link',async()=>{
 setup();packet.all.mockResolvedValueOnce([{item_index:0,sku:'TEE',name:'Tee',color:'Navy',sizes:{M:2}}]);
 packet.run.mockResolvedValue({token:'a'.repeat(64)});
 const response=await invoke({action:'download',token:'a'.repeat(64),store_id:'store',dpo_id:'dp1',target_so_id:'SO-2649'});
 expect(response.statusCode).toBe(200);
 const draft=JSON.parse(response.body);
 expect(draft.attachment.name).toBe('DPO_60006.pdf');
 expect(Buffer.from(draft.attachment.content,'base64').toString('ascii').startsWith('%PDF-')).toBe(true);
 expect(packet.authorize.mock.calls[0][1].token).toBe('a'.repeat(64));
 expect(packet.run).not.toHaveBeenCalled();
});
test('long DPO notes paginate into valid PDF pages',async()=>{
 const entry=resolveDpos(orders,decorators,vendors)[0];entry.dp={...entry.dp,notes:'Production instructions\n'.repeat(100)};
 entry.so={...entry.so,items:[]};
 const pdf=Buffer.from(await dpoPdf(entry),'base64').toString('ascii');
 expect((pdf.match(/\/Type \/Page\b/g)||[]).length).toBeGreaterThan(1);
});

test('SO scoped link cannot select a DPO in another SO in the same store',async()=>{
 setup();packet.authorize.mockResolvedValue({admin:{},storeId:'store',soId:'SO-2649'});
 packet.all.mockReset();packet.all.mockResolvedValueOnce([...orders,{id:'SO-OTHER',deco_pos:[{id:'other-dp',po_id:'DPO OTHER'}]}]).mockResolvedValueOnce(decorators).mockResolvedValueOnce(vendors);
 const response=await invoke({action:'download',token:'a'.repeat(64),dpo_id:'other-dp',target_so_id:'SO-OTHER'});
 expect(response.statusCode).toBe(404);
});
test('sharing UI offers visible link and copy message without staff send flow',()=>{
 const source=require('fs').readFileSync(require('path').join(__dirname,'../productionPacket/PacketShare.js'),'utf8');
 expect(source).toContain('Copy message with link');expect(source).toContain('Shareable production packet link');
 expect(source).not.toContain('brevo-proxy');expect(source).not.toContain('Open staff view');
});
test('DPO share link keeps chosen context before the fragment token',()=>{
 const url=dpoShareUrl('a'.repeat(64),{id:'dp 1',soId:'SO-2649'},'https://nsa.example');
 expect(url).toBe('https://nsa.example/production-packet?dpo=dp+1&dpo_so=SO-2649#token='+ 'a'.repeat(64));
 expect(new URL(url).hash).toContain('token=');
});
function dpoContextFixture(){
 const so={id:'SO-1',webstore_id:'store',deco_pos:[{id:'dp-a',po_id:'DPO A',vendor:'Alpha',deco_type:'screen_print',item_idxs:[0],qty:4,expected_date:'2026-10-01',notes:'Use red ink'},{id:'dp-b',po_id:'DPO B',vendor:'Beta',deco_type:'embroidery',item_idxs:[0],qty:5}]};
 const items=[{id:'item-1',so_id:'SO-1',item_index:0,sku:'TEE',color:'Navy',sizes:{M:5}}];
 const decos=[{id:'deco-a',so_item_id:'item-1',deco_index:0,fulfillment:'outside',deco_po_id:'DPO A',vendor:'Alpha'}, {id:'deco-b',so_item_id:'item-1',deco_index:1,fulfillment:'outside',deco_po_id:'DPO B',vendor:'Beta'}];
 const packet={salesOrders:[{id:'SO-1'}],garments:[{id:'garment:item-1',soId:'SO-1',sku:'TEE',color:'Navy',units:5,decorationIds:['decoration:deco-a','decoration:deco-b']}],decorations:[{id:'decoration:deco-a',garmentId:'garment:item-1',soId:'SO-1'},{id:'decoration:deco-b',garmentId:'garment:item-1',soId:'SO-1'}],players:[],notes:[],messages:[],issues:[],ready:true,totals:{garments:5,orders:0,playerUnits:0,players:0},changes:{substitutions:[],sizeChanges:[]}};
 const rows={sales_orders:[so],deco_vendors:[],vendors:[],so_items:items,so_item_decorations:decos};
 const admin={from:table=>{let result=rows[table]||[];const query={select:()=>query,eq:(key,value)=>{result=result.filter(r=>r[key]===value);return query;},in:(key,values)=>{result=result.filter(r=>values.includes(r[key]));return query;},order:()=>query,range:async(start,end)=>({data:result.slice(start,end+1),error:null})};return query;}};
 return {ctx:{admin,storeId:'store',soId:'SO-1'},packet,rows};
}
test('DPO context narrows to the selected decorator work and reports quantity drift',async()=>{
 const {ctx,packet}=dpoContextFixture();
 const result=await attachDpoContext(ctx,packet,{dpo_id:'dp-a',dpo_so_id:'SO-1'});
 expect(result.decorations.map(d=>d.id)).toEqual(['decoration:deco-a']);
 expect(result.garments[0].decorationIds).toEqual(['decoration:deco-a']);
 expect(result.dpo).toMatchObject({number:'DPO A',coveredQuantity:5,discrepancy:{saved:4,covered:5},dueDate:'2026-10-01',notes:'Use red ink'});
 expect(result.dpo.warnings.some(i=>i.includes('differs'))).toBe(true);
 expect(result.ready).toBe(true);
});
test('DPO context cannot select another sales order outside token grant',async()=>{
 const {ctx,packet}=dpoContextFixture();
 await expect(attachDpoContext(ctx,packet,{dpo_id:'dp-a',dpo_so_id:'SO-2'})).rejects.toMatchObject({status:403});
});
test('ambiguous player rows are omitted instead of inflating DPO order totals',async()=>{
 const {ctx,packet}=dpoContextFixture();
 packet.garments.push({id:'garment:other',soId:'SO-1',sku:'TEE',color:'Navy',units:3,decorationIds:[]});
 packet.players=[{id:'player:one',soId:'SO-1',sku:'TEE',color:'Navy',qty:2,orderKey:'order-1',orderId:'1001',player:'A'}];
 const result=await attachDpoContext(ctx,packet,{dpo_id:'dp-a',dpo_so_id:'SO-1'});
 expect(result.players).toEqual([]);
 expect(result.totals.orders).toBe(0);
 expect(result.dpo.warnings.some(w=>w.includes('Player rows'))).toBe(true);
});
test('an unassigned decoration shared by two DPOs is omitted with a warning',async()=>{
 const {ctx,packet,rows}=dpoContextFixture();
 rows.so_item_decorations[0].deco_po_id='';
 rows.so_item_decorations[0].vendor='';
 rows.so_item_decorations[0].deco_type='screen_print';
 rows.sales_orders[0].deco_pos[1].vendor='Alpha';
 rows.sales_orders[0].deco_pos[1].deco_type='screen_print';
 const result=await attachDpoContext(ctx,packet,{dpo_id:'dp-a',dpo_so_id:'SO-1'});
 expect(result.decorations).toEqual([]);
 expect(result.dpo.warnings.some(w=>w.includes('multiple DPOs'))).toBe(true);
});
