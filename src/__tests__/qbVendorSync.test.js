import {buildQBVendorReview,applyQBVendorReview} from '../qbVendorSync';
import {loadAllQBEntities} from '../qbAccountMappings';
jest.mock('../qbAccountMappings',()=>({loadAllQBEntities:jest.fn()}));
const q = {Id:'9',DisplayName:'Methodic',PrimaryEmailAddr:{Address:'qbo@example.com'}};
const v = {id:'m',name:'Methodic',vendor_type:'api',is_active:true,contact_email:'portal@example.com'};
const plan = (vs=[v],qs=[q],links={})=>buildQBVendorReview(vs,qs,links,'realm');
test('links exact names while retaining existing Portal contact and settings',()=>{
  expect(plan()[0]).toMatchObject({action:'link',portalId:'m',patch:{}});
});
test('fills only missing contacts; repeat is unchanged',()=>{
  expect(plan([{...v,contact_email:null}],[q],{m:'9'})[0]).toMatchObject({action:'update',patch:{contact_email:'qbo@example.com'}});
  expect(plan([v],[q],{m:'9'})[0].action).toBe('unchanged');
});
test('saved IDs survive a QBO rename',()=>expect(plan([v],[{...q,DisplayName:'New Methodic'}],{m:'9'})[0]).toMatchObject({action:'unchanged',portalId:'m',portalName:'Methodic'}));
test('new records use deterministic company-scoped IDs',()=>{
  expect(plan([])[0]).toMatchObject({action:'create',portalId:'qbo-realm-9'});
  expect(buildQBVendorReview([], [q], {}, 'other')[0].portalId).not.toBe(plan([])[0].portalId);
});
test.each([
  [[v,{...v,id:'m2'}],[q],{}],
  [[v],[q,{...q,Id:'10'}],{}],
  [[],[q,{...q,Id:'10'}],{}],
  [[v],[q],{m:'another'}],
  [[{...v,is_active:false}],[q],{}],
])('blocks ambiguous, conflicting, or inactive Portal matches', (vs,qs,links)=>expect(plan(vs,qs,links)[0].action).toBe('blocked'));
test('does not import inactive QBO vendors',()=>expect(plan([],[{...q,Active:false}])[0].action).toBe('skip'));
function clientFor(vendors, failReadback=false){
  const writes=[];
  return {writes,from:()=>({
    select:()=>({order:()=>({range:async()=>({data:vendors})}),eq:(_,id)=>({single:async()=>failReadback?{error:{message:'read failure'}}:{data:vendors.find(x=>x.id===id)}})}),
    upsert:async row=>{writes.push(row);vendors.push(row);return{};}
  })};
}
test('persists verified links after insert, then retry creates no duplicates',async()=>{
  const vendors=[];const client=clientFor(vendors);loadAllQBEntities.mockResolvedValue([q]);
  const persistQbLink=jest.fn().mockResolvedValue({});const onSaved=jest.fn();
  const results=await applyQBVendorReview({client,links:{},realmId:'realm',reviewed:plan([]),persistQbLink,onSaved});
  expect(results[0].status).toBe('saved');expect(persistQbLink).toHaveBeenCalledWith(expect.objectContaining({mapKey:'vendorQBMap',qboId:'9'}));
  expect(onSaved).toHaveBeenCalled();
  expect(plan(vendors,[q],{'qbo-realm-9':'9'})[0].action).toBe('unchanged');
});
test('read-back failure never earns a saved link',async()=>{
  const client=clientFor([],true);loadAllQBEntities.mockResolvedValue([q]);const persistQbLink=jest.fn();
  const results=await applyQBVendorReview({client,links:{},realmId:'realm',reviewed:plan([]),persistQbLink});
  expect(results[0].status).toBe('error');expect(persistQbLink).not.toHaveBeenCalled();
});
test('changed review aborts before any writes',async()=>{
  const client=clientFor([]);loadAllQBEntities.mockResolvedValue([{...q,DisplayName:'Changed'}]);
  await expect(applyQBVendorReview({client,links:{},realmId:'realm',reviewed:plan([])})).rejects.toThrow('changed since review');
  expect(client.writes).toEqual([]);
});
