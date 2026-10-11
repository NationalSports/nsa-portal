import {isCommissionEarnedInvoice,canSnapshotLine} from '../commissionSnapshots';
import {isStoreSalesOrder,storeCommissionReady} from '../lib/storeCloseout';
const paid={status:'paid',payments:[{amount:100,date:'10/01/2026'}]};
test.each([{webstore_id:'W'},{omg_store_id:'O'}])('paid store %j waits for cost-confirmed closeout',so=>{
  expect(isStoreSalesOrder(so)).toBe(true);
  expect(isCommissionEarnedInvoice(paid,so)).toBe(false);
  expect(isCommissionEarnedInvoice(paid,{...so,status:'complete'})).toBe(false);
  expect(canSnapshotLine({inv:paid,so,gp:{rev:100,cost:50}})).toBe(false);
  const closed={...so,store_closed_at:'2026-10-11',store_costs_recorded_at:'2026-10-11'};
  expect(isCommissionEarnedInvoice(paid,closed)).toBe(true);
  expect(canSnapshotLine({inv:paid,so:closed,gp:{rev:100,cost:50}})).toBe(true);
  expect(isCommissionEarnedInvoice({...paid,status:'partial'},closed)).toBe(false);
});
test('ordinary invoices retain paid eligibility; unidentified store SO fails closed',()=>{
  expect(isCommissionEarnedInvoice(paid,{})).toBe(true);
  expect(storeCommissionReady({...paid,idempotency_key:'webstore:SO-1'},null)).toBe(false);
});
