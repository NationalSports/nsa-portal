import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import GlobalSearch from '../GlobalSearch';

jest.mock('../components',()=>({Icon:()=>null}));

const baseProps={
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
