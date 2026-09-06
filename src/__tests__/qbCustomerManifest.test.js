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

describe('duplicate-candidate guard before creating a customer',()=>{
  const {buildQBCustomerMatchDiagnostic,normalizeQBDuplicateKey}=require('../qbSyncEngine');
  test('a QBO name differing only by punctuation blocks the creation and names the record',()=>{
    const portal={id:'C9',name:"Crean Lutheran Boy's Volleyball",alpha_tag:'CLBV',payment_terms:'net30'};
    const qbo=[{Id:'900',DisplayName:'Crean Lutheran Boys Volleyball',Active:true,SalesTermRef:{value:'8'}}];
    const row=buildQBCustomerManifest([portal],qbo,terms)[0];
    expect(row.action).toBe('blocked');
    expect(row.reason).toMatch(/Possible existing QBO customer "Crean Lutheran Boys Volleyball" \(#900\)/);
  });
  test('ampersand and company suffix differences are caught too',()=>{
    const qbo=[{Id:'901',DisplayName:'A and B Athletics, Inc.',Active:true}];
    expect(buildQBCustomerManifest([{id:'C10',name:'A & B Athletics',alpha_tag:'AB',payment_terms:'net30'}],qbo,terms)[0].action).toBe('blocked');
  });
  test('genuinely different sibling accounts still propose creation',()=>{
    const qbo=[{Id:'902',DisplayName:'Crean Lutheran High School',Active:true}];
    expect(buildQBCustomerManifest([{id:'C11',name:'Crean Lutheran High School Staff',alpha_tag:'CLHSS',payment_terms:'net30'}],qbo,terms)[0].action).toBe('create');
  });
  test('an inactive QBO near-match does not block a creation',()=>{
    const qbo=[{Id:'903',DisplayName:'Crean Lutheran Boys Volleyball',Active:false}];
    expect(buildQBCustomerManifest([{id:'C12',name:"Crean Lutheran Boy's Volleyball",alpha_tag:'CLBV',payment_terms:'net30'}],qbo,terms)[0].action).toBe('create');
  });
  test('the loose key strips punctuation, ampersands, leading "the" and company suffixes',()=>{
    expect(normalizeQBDuplicateKey("Crean Lutheran Boy's Volleyball")).toBe('crean lutheran boys volleyball');
    expect(normalizeQBDuplicateKey('A & B Athletics, Inc.')).toBe('a and b athletics');
    expect(normalizeQBDuplicateKey('The Sports Barn LLC')).toBe('sports barn');
    expect(normalizeQBDuplicateKey('   ')).toBe('');
  });
  test('the diagnostic counts both sides and samples real names',()=>{
    const portal=[{id:'C1',name:'School',alpha_tag:'S',payment_terms:'net30'},{id:'C2',name:'Only In Portal',alpha_tag:'OIP',payment_terms:'net30'}];
    const qbo=[existing,{Id:'77',DisplayName:'Only In QBO',Active:true},{Id:'78',DisplayName:'Retired',Active:false}];
    const report=buildQBCustomerMatchDiagnostic(portal,qbo,{});
    expect(report).toMatchObject({qboActive:2,qboClaimed:1,qboUnclaimed:1,portalActive:2,portalUnmatched:1});
    expect(report.qboUnclaimedSample).toEqual([{id:'77',displayName:'Only In QBO',companyName:''}]);
    expect(report.portalUnmatchedSample[0]).toMatchObject({sourceId:'C2',displayName:'Only In Portal (OIP)'});
  });
});

// Real records read from the live QuickBooks company on September 6, 2026. QBO stores
// these under exactly the display name the portal writes, and with no payment terms.
describe('a matched QBO customer with no terms on either side',()=>{
  const live=[
    {portal:{id:'c1',name:'310 Volleyball Club',alpha_tag:'3VC',payment_terms:''},
     qbo:{Id:'3001',DisplayName:'310 Volleyball Club (3VC)',CompanyName:'310 Volleyball Club',Active:true}},
    {portal:{id:'c2',name:'805 Elite Volleyball Club',alpha_tag:'8EVC',payment_terms:''},
     qbo:{Id:'3002',DisplayName:'805 Elite Volleyball Club (8EVC)',CompanyName:'805 Elite Volleyball Club',Active:true}},
    {portal:{id:'c3',name:"Crean Lutheran Boy's Volleyball",alpha_tag:'CLBV',payment_terms:''},
     qbo:{Id:'3003',DisplayName:"Crean Lutheran Boy's Volleyball (CLBV)",CompanyName:"Crean Lutheran Boy's Volleyball",Active:true}},
  ];
  const portals=live.map(pair=>pair.portal), qbos=live.map(pair=>pair.qbo);

  test('matching succeeds: the row reports the QBO id even when terms block it',()=>{
    const rows=buildQBCustomerManifest(portals,qbos,terms);
    expect(rows.map(row=>row.qboId)).toEqual(['3001','3002','3003']);
    rows.forEach(row=>{
      expect(row.action).toBe('blocked');
      expect(row.reason).toMatch(/Matched QBO customer #\d+, but neither the Portal nor QBO has payment terms/);
      expect(row.reason).not.toMatch(/Missing portal payment terms/);
    });
  });

  test('with the approved default these are term updates on existing records, never creations',()=>{
    const rows=buildQBCustomerManifest(portals,qbos,terms,{},{blankTermsDefault:'net30'});
    rows.forEach((row,i)=>{
      expect(row).toMatchObject({action:'update_terms',qboId:String(3001+i),termSource:'default'});
      expect(row.desiredTerm).toEqual({value:'8',name:'Net 30'});
    });
    expect(rows.some(row=>row.action==='create')).toBe(false);
  });

  test('a genuinely absent customer still reads as unmatched, with no QBO id',()=>{
    const row=buildQBCustomerManifest([{id:'c9',name:'Not In QuickBooks',alpha_tag:'NIQ',payment_terms:''}],qbos,terms)[0];
    expect(row).toMatchObject({action:'blocked',qboId:''});
    expect(row.reason).toBe('Missing portal payment terms; no default is assumed');
  });
});
