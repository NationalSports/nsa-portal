import { soInvoiceBalance, liveSoInvoices, invoiceBalanceSnapshot } from '../lib/soInvoiceBalance';
import { buildInvoicedQtyMap, invoicedLineOrphans, soLineKey, scopeSoItemsToInvoice } from '../safeHelpers';
import { dP } from '../pricing';

test('SO-1514 split printing reproduces the post-invoice price increase', () => {
  const art = [{id:'a',deco_type:'screen_print',ink_colors:'Color 1\nColor 2\nColor 3'}];
  const deco = {kind:'art',art_file_id:'a',split_runs:[26,9]};
  const price = dP(deco,26,art,35);
  expect(26 * (price.sell - 6)).toBeCloseTo(19.31, 2);
});

test('settles SO-1514 including shipping and tax, then cannot bill those dollars again', () => {
  const prior = {total:2348.58, shipping:104.15, tax:161.43};
  const target = {subtotal:2102.31, shipping:105.12, tax:162.93};
  const balance = soInvoiceBalance({...target, invoices:[prior]});
  expect(balance).toEqual({subtotal:19.31,shipping:0.97,tax:1.5,total:21.78,billed:2348.58});
  expect(soInvoiceBalance({...target,invoices:[prior,balance]}).total).toBe(0);
});

test('subtracts deposits and prior final invoices once regardless of payments', () => {
  const target = {subtotal:100,shipping:5,tax:10};
  const invoices = [{total:57.5,shipping:2.5,tax:5,paid:0,inv_type:'deposit'}];
  expect(soInvoiceBalance({...target,invoices}).total).toBe(57.5);
  invoices[0].paid=57.5;
  expect(soInvoiceBalance({...target,invoices}).total).toBe(57.5);
});

test('shipping-only differences and overbilling preserve signed component balances', () => {
  const invoices=[{total:110,shipping:10,tax:0}];
  expect(soInvoiceBalance({subtotal:100,shipping:15,tax:0,invoices})).toMatchObject({subtotal:0,shipping:5,total:5});
  expect(soInvoiceBalance({subtotal:100,shipping:5,tax:0,invoices}).total).toBe(-5);
});

test('voids/deletions do not consume billing capacity', () => {
  const invoices=[{id:'a',so_id:'SO',status:'open'},{id:'b',so_id:'SO',status:'void'},{id:'c',so_id:'SO',deleted_at:'today'},{id:'d',so_id:'OTHER'}];
  expect(liveSoInvoices(invoices,'SO').map(i=>i.id)).toEqual(['a']);
});

test('dollar adjustments do not consume product units or become orphaned product lines', () => {
  const so={items:[{sku:'tee',sizes:{S:2}}]};
  const inv={line_items:[{qty:2,_so_line_key:soLineKey(so.items[0],0),amount:20},{qty:1,amount:5,_so_balance_adjustment:true}]};
  expect(buildInvoicedQtyMap(so,[inv]).get(soLineKey(so.items[0],0))).toBe(2);
  expect(invoicedLineOrphans(so,[inv])).toEqual([]);
});

test('financial snapshot detects same-id price edits, ignoring row ordering', () => {
  const invoices=[{id:'a',total:20},{id:'b',total:30}];
  expect(invoiceBalanceSnapshot(invoices)).toBe(invoiceBalanceSnapshot([...invoices].reverse()));
  expect(invoiceBalanceSnapshot(invoices)).not.toBe(invoiceBalanceSnapshot([{id:'a',total:21},invoices[1]]));
});


test('price-only invoice prints its adjustment instead of reprinting the whole SO', () => {
  const line={desc:'Remaining order price / prior billing adjustment — SO',qty:1,rate:19.31,amount:19.31,_so_balance_adjustment:true};
  expect(scopeSoItemsToInvoice({inv_type:'final',line_items:[line]},[{sku:'tee',sizes:{S:26}}])).toEqual({items:[],extraLines:[line]});
});

test('snapshot tolerates JSONB key ordering on a server round trip', () => {
  expect(invoiceBalanceSnapshot([{id:'a',line_items:[{qty:1,amount:5}]}])).toBe(invoiceBalanceSnapshot([{id:'a',line_items:[{amount:5,qty:1}]}]));
});
