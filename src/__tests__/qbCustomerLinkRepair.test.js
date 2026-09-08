import {reviewCustomerLinkRepair,applyCustomerLinkRepair} from '../qbCustomerLinkRepair';
function setup(){
  const target={Id:'650',Active:true,DisplayName:'El Camino HS Football (Sac)',PrimaryEmailAddr:{Address:'coach@school.edu'},SalesTermRef:{value:'3'}};
  const qbApi=jest.fn(async(action,{query})=>{
    if(action!=='query')throw new Error('QBO writes forbidden');
    if(query.includes("Id = '2440'"))return{QueryResponse:{Customer:[]}};
    if(query.includes('FROM Term'))return{QueryResponse:{Term:[{Id:'3',Active:true,Name:'Net 30'}]}};
    return{QueryResponse:{Customer:[target]}};
  });
  return {qbApi,target,qbConfig:{realm_id:'r',preflight:{status:'success',realm_id:'r'},custQBMap:{c:'2440'}},customers:[{id:'c',name:'El Camino Sacramento',contacts:[{email:'coach@school.edu'}]}],customerId:'c',targetId:'650'};
}
test('review only queries QBO; apply rechecks and saves one explicit link receipt',async()=>{
  const a=setup(),persistQbLink=jest.fn();
  const review=await reviewCustomerLinkRepair(a);
  expect(review).toMatchObject({previousId:'2440',targetId:'650',oldStatus:'not returned',termName:'Net 30'});
  const before=a.qbApi.mock.calls.length;
  await applyCustomerLinkRepair(a,review,{approved:true,persistQbLink});
  expect(a.qbApi.mock.calls.length).toBe(before*2);
  expect(a.qbApi.mock.calls.every(([action])=>action==='query')).toBe(true);
  expect(persistQbLink).toHaveBeenCalledWith(expect.objectContaining({qboId:'650',expectedPreviousQboId:'2440',evidence:expect.objectContaining({api_readback:true,reviewer_approved:true})}));
});
test.each([
  ['preflight',a=>{a.qbConfig.preflight.realm_id='other'}],
  ['numeric',a=>{a.targetId="650'"}],
  ['Embedded',a=>{a.customers[0].qb_customer_id='2440'}],
  ['claims',a=>{a.customers.push({id:'other',qb_customer_id:'650'})}],
  ['linked transactions',a=>{a.invoices=[{customer_id:'c',qb_invoice_id:'999'}]}],
  ['linked transactions',a=>{a.salesOrders=[{id:'so',customer_id:'c'}];a.qbConfig.qbSOMap={so:'999'}}],
  ['active',a=>{a.target.Active=false}],
  ['email',a=>{a.target.PrimaryEmailAddr.Address='different@school.edu'}],
  ['payment term',a=>{a.target.SalesTermRef={value:'missing'}}],
])('blocks %s',async(message,mutate)=>{const a=setup();mutate(a);await expect(reviewCustomerLinkRepair(a)).rejects.toThrow(message)});
test('active old account blocks before inspecting replacement',async()=>{
  const a=setup();a.qbApi.mockResolvedValueOnce({QueryResponse:{Customer:[{Id:'2440',Active:true}]}});
  await expect(reviewCustomerLinkRepair(a)).rejects.toThrow('still active');expect(a.qbApi).toHaveBeenCalledTimes(1);
});
test('duplicate email blocks',async()=>{
  const a=setup(),original=a.qbApi.getMockImplementation();
  a.qbApi.mockImplementation(async(action,args)=>args.query.includes('SELECT Id, Active, PrimaryEmailAddr')?{QueryResponse:{Customer:[a.target,{...a.target,Id:'999'}]}}:original(action,args));
  await expect(reviewCustomerLinkRepair(a)).rejects.toThrow('not unique');
});
test('no approval and changed reviews never persist',async()=>{
  const a=setup(),persistQbLink=jest.fn(),review=await reviewCustomerLinkRepair(a);
  await expect(applyCustomerLinkRepair(a,review,{persistQbLink})).rejects.toThrow('Approve');
  a.target.DisplayName='Changed identity';
  await expect(applyCustomerLinkRepair(a,review,{approved:true,persistQbLink})).rejects.toThrow('review changed');
  expect(persistQbLink).not.toHaveBeenCalled();
});
