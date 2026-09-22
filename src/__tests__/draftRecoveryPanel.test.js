import React from 'react';
import {render,screen,fireEvent,waitFor,act} from '@testing-library/react';
import DraftRecoveryPanel from '../DraftRecoveryPanel';
import {DRAFT_CHANGE_KEY} from '../lib/draftJournal';
const draft={key:'k',owner:'staff-a',revision:'r',id:'SO-1',ts:1,table:'sales_orders',payload:{id:'SO-1',memo:'Unsaved memo',items:[{}]},durable:true};

test('running save is quiet, but failure exposes the preserved backup',async()=>{
 let saving=true;
 const journal={list:jest.fn().mockImplementation(async()=>[{...draft}]),isSaving:()=>saving,acknowledge:jest.fn()};
 render(<DraftRecoveryPanel owner="staff-a" journal={journal} onReview={()=>{}}/>);
 await act(async()=>{});
 expect(screen.queryByText('SO-1')).toBeNull();
 saving=false;fireEvent(window,new Event('nsa:drafts-changed'));
 expect(await screen.findByText('SO-1')).toBeTruthy();
 expect(journal.acknowledge).not.toHaveBeenCalled();
});

test('rep filter scopes the rows and count without acknowledging hidden copies',async()=>{
 const other={...draft,key:'other',id:'SO-2',payload:{...draft.payload,id:'SO-2'}};
 const journal={list:jest.fn().mockResolvedValue([draft,other]),acknowledge:jest.fn()};
 const {rerender}=render(<DraftRecoveryPanel owner="staff-a" journal={journal} onReview={()=>{}} isVisible={d=>d.id==='SO-1'}/>);
 await screen.findByText('SO-1');expect(screen.queryByText('SO-2')).toBeNull();
 expect(screen.getByText('Draft recovery (1)')).toBeTruthy();
 rerender(<DraftRecoveryPanel owner="staff-a" journal={journal} onReview={()=>{}} isVisible={()=>false}/>);
 expect(screen.queryByText(/Draft recovery/)).toBeNull();
 expect(journal.acknowledge).not.toHaveBeenCalled();
});

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

test('a save acknowledgement in another tab clears the banner',async()=>{
 const journal={list:jest.fn().mockResolvedValueOnce([draft]).mockResolvedValue([])};
 render(<DraftRecoveryPanel owner="staff-a" journal={journal} onReview={()=>{}}/>);
 await screen.findByText('SO-1');
 fireEvent(window,new StorageEvent('storage',{key:DRAFT_CHANGE_KEY,newValue:'changed'}));
 await waitFor(()=>expect(screen.queryByText(/Draft recovery/)).toBeNull());
});

test('a slow older refresh cannot bring back a cleared recovery copy',async()=>{
 let resolveOld;
 const journal={list:jest.fn().mockResolvedValueOnce([draft]).mockImplementationOnce(()=>new Promise(r=>{resolveOld=r})).mockResolvedValue([])};
 render(<DraftRecoveryPanel owner="staff-a" journal={journal} onReview={()=>{}}/>);
 await screen.findByText('SO-1');fireEvent.click(screen.getByText('Refresh drafts'));
 fireEvent(window,new StorageEvent('storage',{key:DRAFT_CHANGE_KEY,newValue:'changed'}));
 await waitFor(()=>expect(screen.queryByText('SO-1')).toBeNull());
 await act(async()=>resolveOld([draft]));
 expect(screen.queryByText('SO-1')).toBeNull();
});

test('discard requires confirmation and removes only the displayed revision',async()=>{
 const confirm=jest.spyOn(window,'confirm').mockReturnValue(false);
 const journal={list:jest.fn().mockResolvedValue([draft]),acknowledge:jest.fn(async()=>{journal.list.mockResolvedValue([]);return true})};
 render(<DraftRecoveryPanel owner="staff-a" journal={journal} onReview={()=>{}}/>);
 await screen.findByText('SO-1');fireEvent.click(screen.getByText('Discard recovery copy'));
 expect(journal.acknowledge).not.toHaveBeenCalled();
 confirm.mockReturnValue(true);fireEvent.click(screen.getByText('Discard recovery copy'));
 await waitFor(()=>expect(screen.queryByText('SO-1')).toBeNull());
 expect(journal.acknowledge).toHaveBeenCalledWith({key:'k',owner:'staff-a',revision:'r'});
 confirm.mockRestore();
});

test('discard preserves a newer draft that arrived during review',async()=>{
 const confirm=jest.spyOn(window,'confirm').mockReturnValue(true);
 const journal={list:jest.fn().mockResolvedValueOnce([draft]).mockResolvedValue([{...draft,revision:'new'}]),acknowledge:jest.fn().mockResolvedValue(false)};
 render(<DraftRecoveryPanel owner="staff-a" journal={journal} onReview={()=>{}}/>);
 await screen.findByText('SO-1');fireEvent.click(screen.getByText('Discard recovery copy'));
 expect((await screen.findByRole('alert')).textContent).toContain('newer copy has been kept');
 expect(screen.getByText('SO-1')).toBeTruthy();confirm.mockRestore();
});
