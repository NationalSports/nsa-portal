import {parseOmgDollar} from '../lib/omgDollarReport';
describe('OMG Dollar Report net amounts',()=>{
 test('CS5XD wrapped PDF refunds reconcile exactly to Accounting gross',()=>{
  const x=parseOmgDollar('Taxes & Fees/Coupons &\nRebates\nOnline Processing\nFee\n$501.37\n($10.62)\nSales Tax\n$580.80\n($11.78)\nTotal Taxes &\nFees:\n$1,059.77\nGrand Total:\n$8,079.77');
  expect(x).toEqual({shipping:0,processing:490.75,tax:569.02,fundraise:0,grand:8079.77});
  expect(7020+x.processing+x.tax).toBe(x.grand);
 });
 test('same-line charged/refunded pairs and unrefunded fields',()=>{
  expect(parseOmgDollar('Shipping $12.00\nOnline Processing Fee $501.37 ($10.62)\nSales Tax $580.80 ($11.78)\nFundraising $25.00\nGrand Total $8,116.77')).toEqual({shipping:12,processing:490.75,tax:569.02,fundraise:25,grand:8116.77});
 });
 test('three-column net is not added a second time',()=>{
  expect(parseOmgDollar('Sales Tax $580.80 ($11.78) $569.02\nGrand Total $8,079.77').tax).toBe(569.02);
 });
 test('rejects inconsistent or ambiguous columns rather than guessing',()=>{
  expect(()=>parseOmgDollar('Sales Tax $580.80 ($11.78) $580.80')).toThrow(/reconcile/);
  expect(()=>parseOmgDollar('Sales Tax $580.80 $11.78')).toThrow(/Ambiguous/);
 });
});
