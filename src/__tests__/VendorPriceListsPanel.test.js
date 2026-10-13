import React from 'react';
import {render,screen,fireEvent,waitFor} from '@testing-library/react';
import '@testing-library/jest-dom';
import VendorPriceLists,{PriceListResults} from '../VendorPriceLists';
import {priceListCall,uploadPriceList} from '../lib/vendorPriceLists';
jest.mock('../lib/vendorPriceLists',()=>({priceListCall:jest.fn(),uploadPriceList:jest.fn(),openPriceList:jest.fn()}));
beforeEach(()=>{priceListCall.mockResolvedValue({documents:[]});});
test('vendor without catalog gets optional upload and can search by vendor id',async()=>{
 render(<VendorPriceLists vendor={{id:'v3',name:'Custom vendor'}}/>);
 expect(await screen.findByText(/No price list uploaded/)).toBeInTheDocument();
 expect(screen.getByLabelText('Upload vendor price list')).toBeEnabled();
 priceListCall.mockResolvedValue({matches:[],stock:[]});
 fireEvent.change(screen.getByLabelText('Search this vendor price lists'),{target:{value:'jersey'}});
 fireEvent.click(screen.getByText('Search',{selector:'button'}));
 await waitFor(()=>expect(priceListCall).toHaveBeenCalledWith('search',{query:'jersey',vendor_id:'v3'}));
 expect(await screen.findByText(/No matching current/)).toBeInTheDocument();
});
test('upload failure is visible and never claims file is searchable',async()=>{
 uploadPriceList.mockRejectedValue(new Error('Page 1 needs OCR'));
 render(<VendorPriceLists vendor={{id:'v3',name:'Custom vendor'}}/>);
 fireEvent.change(screen.getByLabelText('Upload vendor price list'),{target:{files:[new File(['scan'],'scan.pdf',{type:'application/pdf'})]}});
 expect(await screen.findByRole('alert')).toHaveTextContent('needs OCR');
 expect(screen.queryByText(/Price list is searchable/)).not.toBeInTheDocument();
});
test('evidence stays literal, zero stock stays zero, and stale/missing sync is visible',()=>{
 render(<PriceListResults result={{matches:[{document_id:'d',vendor_name:'Adidas',file_name:'Fall.pdf',location:'PDF page 2',content:'JY6033 | USD cost $12.50 | MSRP $25.00',created_at:'2026-01-01'}],stock:[{source:'adidas',sku:'JY6033',size:'L',stock_qty:0,last_synced:null,future_delivery_qty:20,future_delivery_date:'2026-12-01'}]}}/>);
 expect(screen.getByText(/USD cost \$12.50/)).toBeInTheDocument();
 expect(screen.getByText(/PDF page 2/)).toBeInTheDocument();
 expect(screen.getByText('0',{selector:'td'})).toBeInTheDocument();
 expect(screen.getByText('Unknown · stale')).toBeInTheDocument();
 expect(screen.getByText('20 · 2026-12-01')).toBeInTheDocument();
});
