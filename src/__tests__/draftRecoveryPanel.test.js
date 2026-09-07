import React from 'react';
import {render,screen,fireEvent,waitFor} from '@testing-library/react';
import DraftRecoveryPanel from '../DraftRecoveryPanel';
const draft={key:'k',owner:'staff-a',revision:'r',id:'SO-1',ts:1,table:'sales_orders',payload:{id:'SO-1',memo:'Unsaved memo',items:[{}]},durable:true};

test('recovery requires review and carries the exact revision without acknowledging it',async()=>{
 const journal={list:jest.fn().mockResolvedValue([draft]),acknowledge:jest.fn()};const review=jest.fn();
 render(<DraftRecoveryPanel owner="staff-a" journal={journal} onReview={review}/>);
 await screen.findByText('SO-1');fireEvent.click(screen.getByText('Review draft'));
 await waitFor(()=>expect(review).toHaveBeenCalledWith({...draft.payload,_draftRecovery:{key:'k',owner:'staff-a',revision:'r'}},'sales_orders'));
 expect(journal.acknowledge).not.toHaveBeenCalled();
});
test('failed storage is clearly distinguished from a durable recovery copy',async()=>{
 const journal={list:jest.fn().mockResolvedValue([{...draft,durable:false}])};
 render(<DraftRecoveryPanel owner="staff-a" journal={journal} onReview={()=>{}}/>);
 expect((await screen.findByRole('alert')).textContent).toContain('Only available in this open tab');
 expect(screen.getByText('Download recovery copy')).toBeTruthy();
});
test('changing staff clears previously displayed recovery content',async()=>{
 let resolveB;const journal={list:jest.fn(owner=>owner==='staff-a'?Promise.resolve([draft]):new Promise(r=>{resolveB=r;}))};
 const {rerender}=render(<DraftRecoveryPanel owner="staff-a" journal={journal} onReview={()=>{}}/>);
 await screen.findByText('SO-1');rerender(<DraftRecoveryPanel owner="staff-b" journal={journal} onReview={()=>{}}/>);
 expect(screen.queryByText('SO-1')).toBeNull();resolveB([]);
});
