import React from 'react';
import {render,screen,fireEvent,waitFor} from '@testing-library/react';
import StoreCloseoutReview from '../StoreCloseoutReview';
const base={so_id:'SO-TEST',token:'review-1',assigned_to:'rep',five_week_date:'2026-10-06',blocking_jobs:[],outside:[{key:'po:a',vendor:'Vendor A',label:'DPO-A'},{key:'po:b',vendor:'Vendor B',label:'DPO-B'}]};
test('lists actual blocked jobs and keeps closing disabled',()=>{
 render(<StoreCloseoutReview status={{...base,blocking_jobs:[{id:'J-1',name:'Front logo',status:'error'}]}}/>);
 expect(screen.getByText(/Front logo · J-1 · error/)).toBeTruthy();
 expect(screen.getByRole('button',{name:'Close Store & apply payments'}).disabled).toBe(true);
});
test('requires separate shipment, costs and evidence for every outside decorator',async()=>{
 const submit=jest.fn().mockResolvedValue();render(<StoreCloseoutReview status={base} onSubmit={submit}/>);
 const button=screen.getByRole('button',{name:'Close Store & apply payments'});
 screen.getAllByRole('checkbox').forEach(c=>fireEvent.click(c));expect(button.disabled).toBe(true);
 const evidence=screen.getAllByLabelText('Shipment evidence and final-cost reference');
 fireEvent.change(evidence[0],{target:{value:'Tracking A; final bill A'}});expect(button.disabled).toBe(true);
 fireEvent.change(evidence[1],{target:{value:'Delivery B; final bill B'}});expect(button.disabled).toBe(false);
 fireEvent.click(button);await waitFor(()=>expect(submit).toHaveBeenCalledWith(expect.objectContaining({action:'close',token:'review-1',confirmations:expect.objectContaining({shipped:true,costs:true})})));
});
test('partial review creates follow-up without attempting closeout',async()=>{
 const submit=jest.fn().mockResolvedValue();render(<StoreCloseoutReview status={base} onSubmit={submit}/>);
 fireEvent.change(screen.getByLabelText('What is missing / next action'),{target:{value:'Waiting for Vendor B freight bill'}});
 fireEvent.click(screen.getByRole('button',{name:'Save review & rep follow-up'}));await waitFor(()=>expect(submit).toHaveBeenCalledWith(expect.objectContaining({action:'follow_up',note:'Waiting for Vendor B freight bill'})));
 expect(screen.getByRole('button',{name:'Close Store & apply payments'}).disabled).toBe(true);
});
test('missing rep prevents an unowned follow-up',()=>{
 render(<StoreCloseoutReview status={{...base,assigned_to:null}}/>);
 expect(screen.getByRole('button',{name:'Save review & rep follow-up'}).disabled).toBe(true);
 expect(screen.getByText(/No active rep is assigned/)).toBeTruthy();
});
