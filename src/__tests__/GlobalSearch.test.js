import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import GlobalSearch from '../GlobalSearch';

jest.mock('../components',()=>({Icon:()=>null,calcSOStatus:so=>so.status||'need_order'}));

const baseProps={
  canAccess:()=>true,
  customers:[{id:'c1',name:'Acme High School',alpha_tag:'AHS'}],
  estimates:[],salesOrders:[],products:[],invoices:[],vendors:[],submittedBatches:[],inventoryPOs:[],
  searchProducts:jest.fn(async()=>({products:[]})),searchTxnItems:jest.fn(async()=>[]),mergeTxnItems:jest.fn(()=>[]),searchWebstoreOrders:jest.fn(async()=>[]),
  searchPOStatus:jest.fn(()=>'waiting'),orderSearchHay:jest.fn(()=>''),
  newTabHref:params=>'/?'+new URLSearchParams(params).toString(),onSeeAll:jest.fn(),onOpen:jest.fn(),
};

beforeEach(()=>jest.clearAllMocks());

test('finds indexed portal records and opens the selected result',async()=>{
  render(<div style={{position:'relative'}}><GlobalSearch {...baseProps}/></div>);
  fireEvent.change(screen.getByPlaceholderText(/Search everything/),{target:{value:'Acme'}});
  await waitFor(()=>expect(screen.getByText('Acme High School')).toBeTruthy());
  fireEvent.click(screen.getByText('Acme High School'));
  expect(baseProps.onOpen).toHaveBeenCalledWith('customer',baseProps.customers[0],expect.any(Map));
});

test('submits the complete query only when Enter is pressed',()=>{
  render(<GlobalSearch {...baseProps}/>);
  const input=screen.getByPlaceholderText(/Search everything/);
  fireEvent.change(input,{target:{value:'SO-1234'}});
  expect(baseProps.onSeeAll).not.toHaveBeenCalled();
  fireEvent.keyDown(input,{key:'Enter'});
  expect(baseProps.onSeeAll).toHaveBeenCalledWith('SO-1234');
});

 test('customer search shows open orders before estimates and exact IDs still find closed orders', async()=>{
  const orders=[{id:'SO-1000',customer_id:'c1',status:'complete'}, {id:'SO-1001',customer_id:'c1',status:'cancelled'}, {id:'SO-1002',customer_id:'c1',status:'waiting_receive'}];
  render(<GlobalSearch {...baseProps} salesOrders={orders} estimates={[{id:'EST-2000',customer_id:'c1'}]}/>);
  const input=screen.getByPlaceholderText(/Search everything/);
  fireEvent.change(input,{target:{value:'Acme'}});
  await waitFor(()=>expect(screen.getByText('SO-1002')).toBeTruthy());
  expect(screen.queryByText('SO-1000')).toBeNull();
  expect(screen.queryByText('SO-1001')).toBeNull();
  expect(screen.getByText('SO-1002').compareDocumentPosition(screen.getByText('EST-2000')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  fireEvent.change(input,{target:{value:'SO-1000'}});
  await waitFor(()=>expect(screen.getByText('SO-1000')).toBeTruthy());
});


test('section grants exclude hidden data and immediately hide cached results after revocation',async()=>{
  const props={...baseProps,salesOrders:[{id:'SO-1002',memo:'Acme',customer_id:'c1',status:'waiting_receive',items:[{picks:[{pick_id:'Acme-pick'}]}]}]};
  const {rerender}=render(<GlobalSearch {...props} canAccess={page=>page==='orders'}/>);
  fireEvent.change(screen.getByPlaceholderText(/Search everything/),{target:{value:'Acme'}});
  await waitFor(()=>expect(screen.getByText('SO-1002')).toBeTruthy());
  expect(screen.queryByText('Acme High School')).toBeNull();
  expect(screen.queryByText('Acme-pick')).toBeNull();
  rerender(<GlobalSearch {...props} canAccess={()=>false}/>);
  expect(screen.queryByText('SO-1002')).toBeNull();
});
