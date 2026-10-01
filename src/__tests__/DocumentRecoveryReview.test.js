import React from 'react';
import {render,screen,fireEvent,waitFor,act} from '@testing-library/react';
import DocumentRecoveryReview from '../DocumentRecoveryReview';
const row={id:'EST-review',_version:5,memo:'cloud text',items:[{line_id:'a',sku:'TEE',sizes:{M:2}}]};
const entry={id:row.id,table:'estimates',payload:{...row,memo:'draft text'}};
const setup=(save,extra={})=>{
  const onSaved=jest.fn(),onClose=jest.fn(),load=jest.fn().mockResolvedValue({row,token:'token-5'});
  const view=render(<DocumentRecoveryReview entry={entry} owner="staff" load={load} save={save} onSaved={onSaved} onClose={onClose} {...extra}/>);
  return {...view,onSaved,onClose,load};
};
test('compares actual values, directly dispatches once and waits for strict success before dismissing',async()=>{
  let finish;const save=jest.fn(()=>new Promise(resolve=>{finish=resolve;}));
  const {onSaved}=setup(save);
  await screen.findByText('cloud text');expect(screen.getByText('draft text')).toBeTruthy();
  fireEvent.click(screen.getByText('Save reviewed draft'));
  fireEvent.click(screen.getByText('Save reviewed draft'));
  expect(save).toHaveBeenCalledTimes(1);expect(onSaved).not.toHaveBeenCalled();
  expect(screen.getByRole('dialog')).toBeTruthy();
  expect(save.mock.calls[0][1]).toMatchObject({_reviewedSaveToken:'token-5',_obBaseVersion:5,memo:'draft text'});
  await act(async()=>finish(true));
  expect(onSaved).toHaveBeenCalledTimes(1);
});
test.each([false,'stale',undefined])('unconfirmed result %s retains recovery review',async result=>{
  const {onSaved}=setup(jest.fn().mockResolvedValue(result));
  await screen.findByText('cloud text');fireEvent.click(screen.getByText('Save reviewed draft'));
  await screen.findByRole('alert');expect(onSaved).not.toHaveBeenCalled();expect(screen.getByRole('dialog')).toBeTruthy();
});
test('load failure cannot enable saving',async()=>{
  const save=jest.fn();setup(save,{load:jest.fn().mockRejectedValue(new Error('Incomplete cloud read'))});
  await screen.findByText('Incomplete cloud read');expect(screen.getByText('Save reviewed draft').disabled).toBe(true);expect(save).not.toHaveBeenCalled();
});
test('unmount/account change during save cannot publish the old result',async()=>{
  let finish;const {unmount,onSaved}=setup(()=>new Promise(resolve=>{finish=resolve;}));
  await screen.findByText('cloud text');fireEvent.click(screen.getByText('Save reviewed draft'));unmount();
  await act(async()=>finish(true));expect(onSaved).not.toHaveBeenCalled();
});
test('open unsaved edits block recovery without dispatch',async()=>{
  const save=jest.fn();setup(save,{canSave:()=>false});
  await screen.findByText('cloud text');fireEvent.click(screen.getByText('Save reviewed draft'));
  await screen.findByRole('alert');expect(save).not.toHaveBeenCalled();
});
test('matching duplicate lines enables the reviewed save without guessing',async()=>{
  const second={...row.items[0],line_id:'b',sizes:{M:5}};
  const saved={...row,items:[row.items[0],second]};
  const legacy={...entry,payload:{...saved,items:saved.items.map(({line_id,...item})=>item)}};
  const save=jest.fn().mockResolvedValue(false);
  setup(save,{entry:legacy,load:jest.fn().mockResolvedValue({row:saved,token:'t'})});
  await screen.findByText('Match duplicate product lines');
  expect(screen.getByText('Save reviewed draft').disabled).toBe(true);
  fireEvent.change(screen.getByLabelText('Match draft line 1'),{target:{value:'a'}});
  fireEvent.change(screen.getByLabelText('Match draft line 2'),{target:{value:'a'}});
  expect(screen.getByText('Save reviewed draft').disabled).toBe(true);
  fireEvent.change(screen.getByLabelText('Match draft line 2'),{target:{value:'b'}});
  fireEvent.click(screen.getByText('Save reviewed draft'));
  await waitFor(()=>expect(save).toHaveBeenCalled());
  expect(save.mock.calls[0][1].items.map(item=>item.line_id)).toEqual(['a','b']);
});
