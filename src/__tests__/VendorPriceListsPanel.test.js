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

test('drop uploads one file with optional dates and refreshes the library',async()=>{
 uploadPriceList.mockReset().mockResolvedValue('new');
 render(<VendorPriceLists vendor={{id:'v3',name:'Custom vendor'}}/>);
 await screen.findByText(/No price list uploaded/);
 fireEvent.change(screen.getByLabelText('Price list effective date'),{target:{value:'2026-01-01'}});
 const file=new File(['prices'],'new.xlsx');
 fireEvent.drop(screen.getByTestId('price-list-dropzone'),{dataTransfer:{files:[file]}});
 await waitFor(()=>expect(uploadPriceList).toHaveBeenCalledWith('v3',file,{effective_date:'2026-01-01',expires_on:''},expect.any(Function)));
 expect(await screen.findByText(/Price list is searchable/)).toBeInTheDocument();
});
test('drop rejects multiple files, unsupported files, and reversed dates',async()=>{
 uploadPriceList.mockReset();
 render(<VendorPriceLists vendor={{id:'v3',name:'Custom vendor'}}/>);
 await screen.findByText(/No price list uploaded/);
 const zone=screen.getByTestId('price-list-dropzone');
 fireEvent.drop(zone,{dataTransfer:{files:[new File(['a'],'a.pdf'),new File(['b'],'b.pdf')]}});
 expect(screen.getByRole('alert')).toHaveTextContent('one price list');
 fireEvent.drop(zone,{dataTransfer:{files:[new File(['a'],'a.exe')]}});
 expect(screen.getByRole('alert')).toHaveTextContent('PDF, XLS or XLSX');
 fireEvent.change(screen.getByLabelText('Price list effective date'),{target:{value:'2026-02-01'}});
 fireEvent.change(screen.getByLabelText('Price list expiry date'),{target:{value:'2026-01-01'}});
 fireEvent.drop(zone,{dataTransfer:{files:[new File(['a'],'a.pdf')]}});
 expect(screen.getByRole('alert')).toHaveTextContent('Expiry date');
 expect(uploadPriceList).not.toHaveBeenCalled();
});
test('a second drop cannot start another upload while processing',async()=>{
 let finish;uploadPriceList.mockReset().mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
 render(<VendorPriceLists vendor={{id:'v3',name:'Custom vendor'}}/>);
 await screen.findByText(/No price list uploaded/);
 const drop={dataTransfer:{files:[new File(['a'],'a.pdf')]}};
 fireEvent.drop(screen.getByTestId('price-list-dropzone'),drop);
 fireEvent.drop(screen.getByTestId('price-list-dropzone'),drop);
 expect(uploadPriceList).toHaveBeenCalledTimes(1);
 expect(screen.getByLabelText('Upload vendor price list')).toBeDisabled();
 finish();await screen.findByText(/Price list is searchable/);
});
test('ready files outside their date window do not claim to be searchable',async()=>{
 priceListCall.mockResolvedValue({documents:[{id:'future',file_name:'future.xlsx',status:'ready',effective_date:'2999-01-01'},{id:'old',file_name:'old.pdf',status:'ready',expires_on:'2000-01-01'}]});
 render(<VendorPriceLists vendor={{id:'v3',name:'Custom vendor'}}/>);
 expect(await screen.findByText('Scheduled')).toBeInTheDocument();
 expect(screen.getByText('Expired')).toBeInTheDocument();
 expect(screen.getByText('0 searchable')).toBeInTheDocument();
});
test('spreadsheet search presents the matching item and hides surrounding source rows',()=>{
 render(<PriceListResults result={{query:'kas',matches:[{document_id:'d',vendor_name:'Athletic Specialties',file_name:'list.xlsx',location:'Sheet1 · rows 604–605',content:'Column labels:\nRow 1: Item | Description | Price\nSource rows:\nRow 604: KAL | ADULT PAD | 8.37\nRow 605: KAS | LIGHTWEIGHT KNEE PAD | 2.15'}]}}/>);
 expect(screen.getByRole('cell',{name:'KAS'})).toBeInTheDocument();
 expect(screen.getByRole('cell',{name:'2.15'})).toBeInTheDocument();
 expect(screen.queryByRole('cell',{name:'KAL'})).not.toBeInTheDocument();
 expect(screen.getByText(/Source details/).closest('details')).not.toHaveAttribute('open');
 expect(screen.queryByText('Synced availability')).not.toBeInTheDocument();
});
