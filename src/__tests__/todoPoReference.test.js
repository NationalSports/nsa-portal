import { todoTextReferencesPo } from '../App';

describe('TODO purchase-order reference matching',()=>{
  test('does not turn unrelated account counts into PO links',()=>{
    const text='304 accounts need attention. No payment terms: 295 · No billing email: 235.';
    expect(todoTextReferencesPo('3295 THGS',text)).toBe(false);
  });

  test('accepts a full PO id or an explicit exact PO number',()=>{
    expect(todoTextReferencesPo('3295 THGS','Receive 3295 THGS for this order')).toBe(true);
    expect(todoTextReferencesPo('3295 THGS','Please check PO 3295 today')).toBe(true);
    expect(todoTextReferencesPo('3295 THGS','Please check PO 295 today')).toBe(false);
  });
});
