import React from 'react';
import {render,screen,fireEvent,waitFor} from '@testing-library/react';
import '@testing-library/jest-dom';
import OrderPriceListSearch from '../OrderPriceListSearch';
import {priceListCall} from '../lib/vendorPriceLists';
jest.mock('../lib/vendorPriceLists',()=>({priceListCall:jest.fn(),openPriceList:jest.fn()}));
const result={matches:[{document_id:'d',vendor_id:'ns_35',vendor_name:'Athletic Specialties',file_name:'ASI.xlsx',location:'Sheet1',content:'Column labels:\nRow 1: Item | Description | Price\nSource rows:\nRow 2: JRL | JUMP ROPE | 12.56'}]};
test('order search offers source item and passes selection for custom-item review',async()=>{
 priceListCall.mockResolvedValue(result);const select=jest.fn();
 render(<OrderPriceListSearch query="JRL" onSelect={select}/>);
 fireEvent.click(await screen.findByRole('button',{name:'Use item'}));
 expect(priceListCall).toHaveBeenCalledWith('search',{query:'JRL'});
 expect(select).toHaveBeenCalledWith(expect.objectContaining({sku:'JRL',cost:12.56,vendor_id:'ns_35'}));
});
test('a late result for an old query cannot be selected',async()=>{
 let finish;priceListCall.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;})).mockResolvedValue({matches:[]});
 const {rerender}=render(<OrderPriceListSearch query="JRL" onSelect={jest.fn()}/>);
 await waitFor(()=>expect(finish).toBeDefined());
 rerender(<OrderPriceListSearch query="KAS" onSelect={jest.fn()}/>);
 finish(result);
 expect(await screen.findByText(/No matching item rows/)).toBeInTheDocument();
 expect(screen.queryByRole('button',{name:'Use item'})).not.toBeInTheDocument();
});
