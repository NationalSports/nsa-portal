import React from 'react';
import {render,screen,fireEvent,waitFor} from '@testing-library/react';
import FulfillmentPlanning,{DockArrivalButton} from '../FulfillmentPlanning';
import ItemShipEstimate from '../storefront/ItemShipEstimate';
import {authFetch} from '../utils';
jest.mock('../utils',()=>({authFetch:jest.fn()}));
const originalCrypto=global.crypto;
afterEach(()=>Object.defineProperty(global,'crypto',{configurable:true,value:originalCrypto}));
beforeEach(()=>jest.clearAllMocks());
test('planning displays department capacity, check-in learning, and blocked jobs',async()=>{
 authFetch.mockResolvedValue({ok:true,json:async()=>({model:{methods:{embroidery:{method:'embroidery',completed_jobs:10,active_days:5,jobs_per_day:2,units_per_day:40,run_minutes:120}},checkin:{days:2,samples:3,qualified:false},calculated_at:'2026-10-12T20:00:00Z'},plan:[{so_id:'SO',job_id:'J',method:'embroidery',units:20,reason:'Waiting for release',finish_date:null}]})});
 render(<FulfillmentPlanning/>);fireEvent.click(screen.getByText('Show estimates'));
 expect(await screen.findByText('Waiting for release')).toBeTruthy();
 expect(screen.getByText(/default while learning from/)).toBeTruthy();
 expect(screen.getByText(/10 across 5 days/)).toBeTruthy();
});
test('dock arrival retry retains request ID and never confirms receipt',async()=>{
 Object.defineProperty(global,'crypto',{configurable:true,value:{randomUUID:()=> '00000000-0000-4000-8000-000000000001'}});
 authFetch.mockRejectedValueOnce(new Error('Network failed')).mockResolvedValue({ok:true,json:async()=>({ok:true})});
 const buildLines=()=>[{so_id:'SO',item_index:0,po_id:'PO',size:'M',qty:2}];
 render(<DockArrivalButton buildLines={buildLines}/>);
 fireEvent.click(screen.getByRole('button'));await screen.findByText('Network failed');
 fireEvent.click(screen.getByRole('button'));await screen.findByText(/Dock arrival recorded/);
 await waitFor(()=>expect(authFetch).toHaveBeenCalledTimes(2));
 const bodies=authFetch.mock.calls.map(c=>JSON.parse(c[1].body));expect(bodies[0]).toEqual(bodies[1]);expect(bodies[0].action).toBe('record_arrival');
});
test('customer estimate distinguishes production finish from pending dispatch',()=>{
 render(<ItemShipEstimate estimate={{state:'ready',estimate_basis:'learned',production_finish_date:'2026-12-15',ship_date:null,dispatch_pending:true}}/>);
 expect(screen.getByText('Estimated production finish: Dec 15, 2026')).toBeTruthy();
 expect(screen.getByText(/shipment timing still being confirmed/)).toBeTruthy();
 expect(screen.queryByText('Estimated to ship: Dec 15, 2026')).toBeNull();
});
