jest.mock('../../netlify/functions/store-production-packet',()=>({_internals:{authorize:jest.fn(),all:jest.fn(),run:jest.fn()}}));
const {_internals:packet}=require('../../netlify/functions/store-production-packet');
const {handler}=require('../../netlify/functions/store-production-email');
const {resolveDpos,dpoPdf}=require('../../netlify/functions/_packetDpo');
const orders=[{id:'SO-2649',deco_pos:[{id:'dp1',po_id:'DPO 60006',vendor:'Silver Screen',deco_vendor_id:'dv1',item_idxs:[0],qty:2,unit_cost:3}]}];
const decorators=[{id:'dv1',name:'Silver Screen',vendor_id:'v1'}];
const vendors=[{id:'v1',contact_email:'trinity.lyle@silverscreenprinting.com'}];
const invoke=body=>handler({httpMethod:'POST',body:JSON.stringify(body)});
beforeEach(()=>jest.resetAllMocks());
test('resolves recipient through selected DPO decorator, not a hardcoded store email',()=>{
 expect(resolveDpos(orders,decorators,vendors)[0]).toMatchObject({soId:'SO-2649',email:vendors[0].contact_email,number:'DPO 60006'});
 expect(resolveDpos(orders,decorators,[])[0].email).toBe('');
 expect(resolveDpos([{...orders[0],deco_pos:[{...orders[0].deco_pos[0],status:'cancelled'}]}],decorators,vendors)).toEqual([]);
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
