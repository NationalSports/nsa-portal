import {buildQBCustomerManifest} from '../qbSyncEngine';
const customer={id:'C1',name:'School',alpha_tag:'S',payment_terms:'net30'};
const terms=[{Id:'8',Name:'Net 30',DueDays:30,Active:true}];
const existing={Id:'12',DisplayName:'  SCHOOL   (S) ',Active:true,SalesTermRef:{value:'8'}};
test('exact normalized names and matching terms produce a read-only link plan',()=>{
  expect(buildQBCustomerManifest([customer],[existing],terms)[0]).toMatchObject({action:'link',qboId:'12'});
});
test('missing and ambiguous terms are exceptions, never defaults',()=>{
  expect(buildQBCustomerManifest([{...customer,payment_terms:''}],[existing],terms)[0].reason).toMatch(/Missing/);
  expect(buildQBCustomerManifest([customer],[existing],[...terms,{...terms[0],Id:'9'}])[0].action).toBe('blocked');
});
test('creation and term updates are separately identified for approval',()=>{
  expect(buildQBCustomerManifest([customer],[],terms)[0].action).toBe('create');
  expect(buildQBCustomerManifest([customer],[{...existing,SalesTermRef:{value:'4'}}],terms)[0].action).toBe('update_terms');
});
test('stale, inactive, and conflicting IDs cannot enter a batch',()=>{
  expect(buildQBCustomerManifest([customer],[],terms,{C1:'12'})[0].action).toBe('blocked');
  expect(buildQBCustomerManifest([customer],[{...existing,Active:false}],terms,{C1:'12'})[0].action).toBe('blocked');
  expect(buildQBCustomerManifest([{...customer,qb_customer_id:'13'}],[existing],terms,{C1:'12'})[0].action).toBe('blocked');
});
test('duplicate QBO identities and competing portal sources are blocked',()=>{
  expect(buildQBCustomerManifest([customer],[existing,{...existing,Id:'13'}],terms)[0].action).toBe('blocked');
  expect(buildQBCustomerManifest([customer,{...customer,id:'C2'}],[existing],terms).every(row=>row.action==='blocked')).toBe(true);
});
test('deleted sources are intentionally excluded',()=>{
  expect(buildQBCustomerManifest([{...customer,deleted_at:'2026-01-01'}],[],terms)[0].action).toBe('excluded');
});
