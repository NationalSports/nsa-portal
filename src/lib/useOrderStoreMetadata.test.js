import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import useOrderStoreMetadata from './useOrderStoreMetadata';
function Probe({orders,db}) {
  const r=useOrderStoreMetadata(orders,db,true);
  return <><span>{r.loading?'loading':r.error?'error':r.stores.map(s=>s.id).join(',')}</span><button onClick={r.retry}>retry</button></>;
}
test('metadata load failure is explicit and retry can recover',async()=>{
  const read=jest.fn().mockResolvedValueOnce({error:{message:'unavailable'}}).mockResolvedValueOnce({data:[{id:'club',org_type:'club'}]});
  const db={from:()=>({select:()=>({in:read})})};
  render(<Probe orders={[{webstore_id:'club'}]} db={db}/>);
  await screen.findByText('error');
  fireEvent.click(screen.getByText('retry'));
  await screen.findByText('club');
  expect(read).toHaveBeenCalledWith('id',['club']);
});
test('lookup tracks store IDs without refetching on production-stage updates',async()=>{
  const read=jest.fn().mockResolvedValue({data:[{id:'club'}]});
  const db={from:()=>({select:()=>({in:read})})};
  const {rerender}=render(<Probe orders={[{webstore_id:'club',status:'need_order'}]} db={db}/>);
  await screen.findByText('club');
  rerender(<Probe orders={[{webstore_id:'club',status:'complete'}]} db={db}/>);
  await waitFor(()=>expect(read).toHaveBeenCalledTimes(1));
});
