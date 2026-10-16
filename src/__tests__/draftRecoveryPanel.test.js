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

test('all of this editor’s backups are visible regardless of order assignment',async()=>{
 const other={...draft,key:'other',id:'SO-2',payload:{...draft.payload,id:'SO-2'}};
 const foreign={...draft,key:'foreign',owner:'staff-b',id:'SO-3',payload:{...draft.payload,id:'SO-3'}};
 const journal={list:jest.fn().mockResolvedValue([draft,other,foreign]),acknowledge:jest.fn()};
 render(<DraftRecoveryPanel owner="staff-a" journal={journal} onReview={()=>{}}/>);
 await screen.findByText('SO-1');expect(screen.getByText('SO-2')).toBeTruthy();
 expect(screen.queryByText('SO-3')).toBeNull();
 expect(screen.getByText('Draft recovery (2)')).toBeTruthy();
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

test('download & clear all saves a file first, then clears every listed copy in one step',async()=>{
 const confirm=jest.spyOn(window,'confirm').mockReturnValue(true);
 const created=jest.fn(()=>'blob:x');const origCreate=URL.createObjectURL,origRevoke=URL.revokeObjectURL;
 URL.createObjectURL=created;URL.revokeObjectURL=()=>{};
 const click=jest.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(()=>{});
 const other={...draft,key:'k2',revision:'r2',id:'SO-2',payload:{...draft.payload,id:'SO-2'}};
 const journal={list:jest.fn().mockResolvedValue([draft,other]),acknowledge:jest.fn(async()=>true)};
 render(<DraftRecoveryPanel owner="staff-a" journal={journal} onReview={()=>{}}/>);
 await screen.findByText('SO-2');
 journal.list.mockResolvedValue([]);
 fireEvent.click(screen.getByText('Download & clear all'));
 await waitFor(()=>expect(screen.queryByText('SO-1')).toBeNull());
 expect(created).toHaveBeenCalledTimes(1);expect(click).toHaveBeenCalled();
 expect(journal.acknowledge).toHaveBeenCalledWith({key:'k',owner:'staff-a',revision:'r'});
 expect(journal.acknowledge).toHaveBeenCalledWith({key:'k2',owner:'staff-a',revision:'r2'});
 expect(confirm).toHaveBeenCalledTimes(1);
 URL.createObjectURL=origCreate;URL.revokeObjectURL=origRevoke;click.mockRestore();confirm.mockRestore();
});

test('an older copy a newer copy already holds clears itself',async()=>{
 const older={...draft,key:'old',revision:'r-old',ts:1},newer={...draft,key:'new',revision:'r-new',ts:2};
 const journal={list:jest.fn().mockResolvedValueOnce([newer,older]).mockResolvedValue([newer]),acknowledge:jest.fn(async()=>true)};
 render(<DraftRecoveryPanel owner="staff-a" journal={journal} onReview={()=>{}}/>);
 await screen.findByText('Draft recovery (1)');
 expect(journal.acknowledge).toHaveBeenCalledWith({key:'old',owner:'staff-a',revision:'r-old'});
 expect(journal.acknowledge).toHaveBeenCalledTimes(1);
});

test('a different older copy of the same order stays listed',async()=>{
 const older={...draft,key:'old',revision:'r-old',ts:Date.now()-1000,payload:{...draft.payload,memo:'Edit A'}};
 const newer={...draft,key:'new',revision:'r-new',ts:Date.now(),payload:{...draft.payload,memo:'Edit B'}};
 const journal={list:jest.fn().mockResolvedValue([newer,older]),acknowledge:jest.fn()};
 render(<DraftRecoveryPanel owner="staff-a" journal={journal} onReview={()=>{}}/>);
 await screen.findByText('Draft recovery (2)');
 expect(journal.acknowledge).not.toHaveBeenCalled();
});

test('a week-old copy clears only once its order was saved past it and closed out',async()=>{
 const week=8*24*60*60*1000,now=Date.now();
 const mk=(id,ts,payload)=>({...draft,key:id,revision:'r-'+id,id,ts,payload:{...draft.payload,id,...payload}});
 const closed=mk('SO-1',now-week,{status:'waiting_receive',_version:12,_obBaseVersion:10});// cloud v11, complete → clears
 const fresh=mk('SO-2',now-1000,{status:'need_order',_version:3});// cloud complete but copy is new → stays
 const openOrder=mk('SO-3',now-week,{status:'ready_to_invoice',_version:25});// SO-1030 shape: cloud newer but not closed → stays
 const sameVersion=mk('SO-4',now-week,{status:'need_order',_version:7});// cloud complete at the same version → stays
 const copyComplete=mk('SO-5',now-week,{status:'complete',_version:4});// the copy itself closed the order → stays
 const estimate={...mk('EST-6',now-week,{_version:1}),table:'estimates'};// estimates never age out
 const all=[closed,fresh,openOrder,sameVersion,copyComplete,estimate];
 const journal={list:jest.fn().mockResolvedValueOnce(all).mockResolvedValue(all.slice(1)),acknowledge:jest.fn(async()=>true)};
 const cloud={'SO-1':{_version:11,status:'complete'},'SO-2':{_version:9,status:'complete'},'SO-3':{_version:26,status:'need_order'},'SO-4':{_version:7,status:'complete'},'SO-5':{_version:9,status:'complete'}};
 const loadSavedVersions=jest.fn(async(table,ids)=>ids.map(id=>({id,...cloud[id]})));
 render(<DraftRecoveryPanel owner="staff-a" journal={journal} loadSavedVersions={loadSavedVersions} onReview={()=>{}}/>);
 await screen.findByText('Draft recovery (5)');
 expect(journal.acknowledge).toHaveBeenCalledTimes(1);
 expect(journal.acknowledge).toHaveBeenCalledWith({key:'SO-1',owner:'staff-a',revision:'r-SO-1'});
 expect(loadSavedVersions).toHaveBeenCalledWith('sales_orders',['SO-1','SO-3','SO-4','SO-5']);
});

test('a failed version check keeps every copy',async()=>{
 const stale={...draft,ts:Date.now()-8*24*60*60*1000,payload:{...draft.payload,status:'need_order',_version:2}};
 const journal={list:jest.fn().mockResolvedValue([stale]),acknowledge:jest.fn()};
 render(<DraftRecoveryPanel owner="staff-a" journal={journal} loadSavedVersions={async()=>{throw new Error('offline')}} onReview={()=>{}}/>);
 await screen.findByText('SO-1');
 expect(journal.acknowledge).not.toHaveBeenCalled();
});
