import {omgCloseoutPlatformCost} from '../lib/storeCloseout';
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

test('OMG commission cost includes report platform/card/invoiced fees once; webstore costs remain separate',()=>{
  expect(omgCloseoutPlatformCost({omg_store_id:'O',_omg_omg_fees:314.26,_omg_cc_fees:257.15})).toBeCloseTo(571.41);
  expect(omgCloseoutPlatformCost({omg_store_id:'O',store_closeout_platform_cost:580,_omg_omg_fees:314.26,_omg_cc_fees:257.15})).toBe(580);
  expect(omgCloseoutPlatformCost({webstore_id:'W',_omg_cc_fees:30})).toBe(0);
});
