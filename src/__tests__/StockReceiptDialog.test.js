import React from 'react';
import {render,screen,fireEvent} from '@testing-library/react';
import StockReceiptDialog from '../StockReceiptDialog';

test('stock confirmation offers repeat printing without submitting another receipt',()=>{
  const onPrint=jest.fn(),onClose=jest.fn();
  render(<StockReceiptDialog labels={[{code:'PO 1010 NSA',items:[{title:'ABC Shirt',detail:'Navy · 3 units',sizes:'M: 3'}]}]} onPrint={onPrint} onClose={onClose}/>);
  expect(screen.getByRole('dialog').textContent).toContain('NSA STOCK');
  expect(screen.getByText('PO 1010 NSA')).toBeTruthy();
  fireEvent.click(screen.getByRole('button',{name:'Print Label'}));
  fireEvent.click(screen.getByRole('button',{name:'Print Label'}));
  expect(onPrint).toHaveBeenCalledTimes(2);
  expect(onClose).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button',{name:'Done'}));
  expect(onClose).toHaveBeenCalledTimes(1);
});
