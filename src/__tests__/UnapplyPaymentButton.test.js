import React from 'react';
import {render,screen,fireEvent,waitFor} from '@testing-library/react';
import UnapplyPaymentButton from '../UnapplyPaymentButton';
import {authFetch} from '../utils';
jest.mock('../utils',()=>({authFetch:jest.fn()}));
const props={invoice:{id:'INV-1'},payment:{amount:100,ref:'58415',method:'check',date:'10/06/2026'},user:{id:'00000000-0000-0000-0000-000000000040'},nf:jest.fn(),onSaved:jest.fn()};
beforeEach(()=>jest.clearAllMocks());
test('requires a reason and shows explicit QBO limitation; only adopts server success',async()=>{
 const result={invoice:{id:'INV-1',paid:0,payment_revision:1},payments:[],qbo_review_required:true};
 authFetch.mockResolvedValue({ok:true,json:async()=>result});render(<UnapplyPaymentButton {...props}/>);
 fireEvent.click(screen.getByText('Unapply'));expect(screen.getByText(/QuickBooks is not changed/)).toBeTruthy();
 expect(screen.getByText('Confirm unapply').disabled).toBe(true);
 fireEvent.change(screen.getByLabelText('Reason for unapplying'),{target:{value:'Wrong invoice'}});
 fireEvent.click(screen.getByText('Confirm unapply'));
 await waitFor(()=>expect(props.onSaved).toHaveBeenCalledWith(result));expect(props.nf).toHaveBeenCalledWith(expect.stringMatching(/QuickBooks is unchanged/));
});
test('failure preserves invoice state and dialog',async()=>{
 authFetch.mockResolvedValue({ok:false,json:async()=>({error:'Payment changed'})});render(<UnapplyPaymentButton {...props}/>);
 fireEvent.click(screen.getByText('Unapply'));fireEvent.change(screen.getByLabelText('Reason for unapplying'),{target:{value:'Wrong invoice'}});fireEvent.click(screen.getByText('Confirm unapply'));
 await waitFor(()=>expect(props.nf).toHaveBeenCalledWith('Payment changed','error'));expect(props.onSaved).not.toHaveBeenCalled();expect(screen.getByRole('dialog')).toBeTruthy();
});
test('cards, imported invoices and unapproved staff have no action',()=>{
 const {rerender}=render(<UnapplyPaymentButton {...props} payment={{...props.payment,method:'cc'}}/>);expect(screen.queryByText('Unapply')).toBeNull();
 rerender(<UnapplyPaymentButton {...props} invoice={{id:'INV-1',_hist:true}}/>);expect(screen.queryByText('Unapply')).toBeNull();
 rerender(<UnapplyPaymentButton {...props} user={{id:'sales'}}/>);expect(screen.queryByText('Unapply')).toBeNull();
});
