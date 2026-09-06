import {buildQBCustomerManifest} from '../qbSyncEngine';
const customer={id:'C1',name:'School',alpha_tag:'S',payment_terms:'net30'};
const terms=[{Id:'8',Name:'Net 30',DueDays:30,Active:true}];
const existing={Id:'12',DisplayName:'  SCHOOL   (S) ',Active:true,SalesTermRef:{value:'8'}};
test('exact normalized names and matching terms produce a read-only link plan',()=>{
  expect(buildQBCustomerManifest([customer],[existing],terms)[0]).toMatchObject({action:'link',qboId:'12'});
});
test('missing and ambiguous terms are exceptions, never defaults',()=>{
  expect(buildQBCustomerManifest([{...customer,payment_terms:''}],[],terms)[0].reason).toMatch(/Missing/);
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
describe('blank portal payment terms',()=>{
  const blank={...customer,payment_terms:''};
  test('an existing QBO customer keeps its own active terms as a link-only plan',()=>{
    const row=buildQBCustomerManifest([blank],[existing],terms)[0];
    expect(row).toMatchObject({action:'link',qboId:'12',termSource:'qbo',desiredTerm:{value:'8',name:'Net 30'}});
    expect(row.reason).toMatch(/keeping QBO terms Net 30/);
  });
  test('an existing QBO customer whose term is inactive or unknown still blocks without a default',()=>{
    expect(buildQBCustomerManifest([blank],[{...existing,SalesTermRef:{value:'99'}}],terms)[0]).toMatchObject({action:'blocked'});
    expect(buildQBCustomerManifest([blank],[{...existing,SalesTermRef:{value:'9'}}],[...terms,{Id:'9',Name:'Net 15',DueDays:15,Active:false}])[0].action).toBe('blocked');
  });
  test('a missing QBO customer blocks unless the reviewer explicitly chose a default',()=>{
    expect(buildQBCustomerManifest([blank],[],terms)[0]).toMatchObject({action:'blocked',reason:expect.stringMatching(/no default is assumed/)});
    const row=buildQBCustomerManifest([blank],[],terms,{},{blankTermsDefault:'net30'})[0];
    expect(row).toMatchObject({action:'create',termSource:'default',desiredTerm:{value:'8'}});
    expect(row.reason).toMatch(/reviewer default Net 30/);
  });
  test('the reviewer default never overrides real portal terms or an existing QBO term',()=>{
    const net15=[...terms,{Id:'9',Name:'Net 15',DueDays:15,Active:true}];
    expect(buildQBCustomerManifest([{...customer,payment_terms:'net15'}],[existing],net15,{},{blankTermsDefault:'net30'})[0]).toMatchObject({action:'update_terms',termSource:'portal',desiredTerm:{value:'9'}});
    expect(buildQBCustomerManifest([blank],[{...existing,SalesTermRef:{value:'9'}}],net15,{},{blankTermsDefault:'net30'})[0]).toMatchObject({action:'link',termSource:'qbo',desiredTerm:{value:'9'}});
  });
  test('unsupported or unresolvable defaults block instead of guessing',()=>{
    expect(()=>buildQBCustomerManifest([blank],[],terms,{},{blankTermsDefault:'whenever'})).toThrow(/Unsupported/);
    expect(buildQBCustomerManifest([blank],[],terms,{},{blankTermsDefault:'net45'})[0]).toMatchObject({action:'blocked',reason:expect.stringMatching(/was not found/)});
  });
});
