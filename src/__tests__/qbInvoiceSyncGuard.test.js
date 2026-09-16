import {
  acquireQBInvoiceSyncClaim,
  applyQBInvoiceLiveReadiness,
  classifyQBInvoiceDuplicate,
  normalizeQBInvoiceDocumentNumber,
  qbInvoiceDocumentNumberForms,
  qbInvoiceSourceKey,
  releaseQBInvoiceSyncClaim,
} from '../qbInvoiceSyncGuard';

const source=(documentNumber='INV63133')=>({
  invoiceId:'portal-row',sourceId:'netsuite:63133',sourceInternalId:'63133',documentNumber,
  qboCustomerId:'C-88',date:'2026-09-14',total:123.456,action:'ready',duplicateCheckEligible:true,
});
const qbo=(overrides={})=>({Id:'900',DocNumber:'NS-INV63133',CustomerRef:{value:'C-88'},TxnDate:'2026-09-14',TotalAmt:123.46,...overrides});

test.each([
  ['INV63133','INV63133'],['NS-INV63133','INV63133'],['INV63199','INV63199'],['NS-INV63255','INV63255'],
])('normalizes optional NS prefix: %s', (input,expected) => {
  expect(normalizeQBInvoiceDocumentNumber(input)).toBe(expected);
  expect(qbInvoiceDocumentNumberForms(input)).toEqual([expected,'NS-'+expected]);
});

test('links only one exact normalized-number/customer/date/cents match',()=>{
  expect(classifyQBInvoiceDuplicate(source(),[qbo()])).toEqual(expect.objectContaining({disposition:'link_existing',qboId:'900'}));
  expect(applyQBInvoiceLiveReadiness([source()],[qbo()])[0]).toEqual(expect.objectContaining({action:'link_existing',qboId:'900'}));
});

test.each([
  ['customer',{CustomerRef:{value:'OTHER'}},'customer'],
  ['date',{TxnDate:'2026-09-13'},'date'],
  ['amount',{TotalAmt:123.47},'amount'],
])('routes a same-number %s mismatch to manual review',(_label,change,field)=>{
  const result=classifyQBInvoiceDuplicate(source(),[qbo(change)]);
  expect(result.disposition).toBe('manual_review');
  expect(result.conflicts[0].differences).toEqual(expect.arrayContaining([expect.objectContaining({field})]));
});

test('two records claiming either accepted number form are ambiguous even if one is exact',()=>{
  const result=classifyQBInvoiceDuplicate(source(),[qbo(),qbo({Id:'901',DocNumber:'INV63133'})]);
  expect(result.disposition).toBe('manual_review');
  expect(result.conflicts).toHaveLength(2);
});

test('durable source keys use the immutable NetSuite ID before display numbers',()=>{
  expect(qbInvoiceSourceKey({id:'INV63133',netsuite_internal_id:'77441'})).toBe('netsuite:77441');
  expect(qbInvoiceSourceKey({id:'INV63133'})).toBe('portal:INV63133');
});

test('claim helpers fail closed and release only the matching token',async()=>{
  const rpc=jest.fn()
    .mockResolvedValueOnce({data:true,error:null})
    .mockResolvedValueOnce({data:false,error:null})
    .mockResolvedValueOnce({data:true,error:null});
  const client={rpc};
  await expect(acquireQBInvoiceSyncClaim(client,{realmId:'r1',sourceId:'netsuite:1',claimToken:'11111111-1111-4111-8111-111111111111'})).resolves.toBe(true);
  await expect(acquireQBInvoiceSyncClaim(client,{realmId:'r1',sourceId:'netsuite:1',claimToken:'22222222-2222-4222-8222-222222222222'})).rejects.toThrow(/already being processed/);
  await expect(releaseQBInvoiceSyncClaim(client,{realmId:'r1',sourceId:'netsuite:1',claimToken:'11111111-1111-4111-8111-111111111111'})).resolves.toBe(true);
});
