jest.mock('../../netlify/functions/_shared',()=>({verifyUser:jest.fn()}));
jest.mock('../../netlify/functions/store-production-packet',()=>({_internals:{authorize:jest.fn(),all:jest.fn(),run:jest.fn()}}));
const {verifyUser}=require('../../netlify/functions/_shared');
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
test('a public packet token cannot retrieve recipient contacts or prepare email',async()=>{
 verifyUser.mockResolvedValue({ok:false,status:401});
 expect((await invoke({action:'prepare',token:'a'.repeat(64)})).statusCode).toBe(401);
 expect(packet.authorize).not.toHaveBeenCalled();
});
function setup(){
 verifyUser.mockResolvedValue({ok:true,teamMemberId:'staff'});
 const q={select:()=>q,eq:()=>q,maybeSingle:async()=>({data:{name:'Staff',email:'staff@example.com'}})};
 packet.authorize.mockResolvedValue({admin:{from:()=>q},storeId:'store'});
 packet.all.mockResolvedValueOnce(orders).mockResolvedValueOnce(decorators).mockResolvedValueOnce(vendors);
}
test('rejects a DPO from another SO before creating a share link',async()=>{
 setup();const response=await invoke({action:'prepare',store_id:'store',dpo_id:'dp1',target_so_id:'other'});
 expect(response.statusCode).toBe(404);expect(packet.run).not.toHaveBeenCalled();
});
test('prepared email attaches selected DPO and creates a link limited to its SO',async()=>{
 setup();packet.all.mockResolvedValueOnce([{item_index:0,sku:'TEE',name:'Tee',color:'Navy',sizes:{M:2}}]);
 packet.run.mockResolvedValue({token:'a'.repeat(64)});
 const response=await invoke({action:'prepare',store_id:'store',dpo_id:'dp1',target_so_id:'SO-2649'});
 expect(response.statusCode).toBe(200);
 const draft=JSON.parse(response.body);
 expect(draft.to).toBe(vendors[0].contact_email);expect(draft.text).toContain(draft.url);
 expect(draft.attachment.name).toBe('DPO_60006.pdf');
 expect(Buffer.from(draft.attachment.content,'base64').toString('ascii').startsWith('%PDF-')).toBe(true);
 expect(packet.run.mock.calls[0][1]).toMatchObject({action:'create_link',scope_so_id:'SO-2649'});
});
test('long DPO notes paginate into valid PDF pages',async()=>{
 const entry=resolveDpos(orders,decorators,vendors)[0];entry.dp={...entry.dp,notes:'Production instructions\n'.repeat(100)};
 entry.so={...entry.so,items:[]};
 const pdf=Buffer.from(await dpoPdf(entry),'base64').toString('ascii');
 expect((pdf.match(/\/Type \/Page\b/g)||[]).length).toBeGreaterThan(1);
});
