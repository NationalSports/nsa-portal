import React from 'react';
import {render,screen,fireEvent,waitFor} from '@testing-library/react';
import OrderMemoDialog from '../OrderMemoDialog';
let counter=0;
beforeAll(()=>{if(!global.crypto)global.crypto={};Object.defineProperty(global.crypto,'randomUUID',{configurable:true,value:()=>`request-${++counter}`});});
const receipt={key:'new-lane',owner:'staff',revision:'new-revision'};
const initial={id:'SO-TEST',ownerId:'staff',expectedMemo:'old memo',memo:'old memo'};
const setup=(overrides={})=>{
 const props={initial,owner:'staff',saveCommand:jest.fn().mockResolvedValue({saved:true,current_memo:'new memo',current_version:99}),onSaved:jest.fn(),onClose:jest.fn(),journal:{stage:jest.fn().mockResolvedValue(receipt),acknowledge:jest.fn().mockResolvedValue(true)},...overrides};
 render(<OrderMemoDialog {...props}/>);return props;
};
const type=async()=>{fireEvent.change(screen.getByLabelText('Your memo'),{target:{value:'new memo'}});await screen.findByText('Recovery copy saved in this browser.');};
test('saving stages the memo before cloud dispatch and acknowledges only after confirmation',async()=>{
 let resolve;const response=new Promise(r=>{resolve=r;});const p=setup({saveCommand:jest.fn(()=>response)});await type();
 fireEvent.click(screen.getByText('Save memo'));
 await waitFor(()=>expect(p.saveCommand).toHaveBeenCalledTimes(1));expect(p.journal.stage).toHaveBeenCalledWith('staff','sales_order_memos',expect.objectContaining({id:'SO-TEST',memo:'new memo'}));
 expect(p.journal.acknowledge).not.toHaveBeenCalled();expect(screen.getByLabelText('Your memo').disabled).toBe(true);
 resolve({saved:true,current_memo:'new memo',current_version:99});
 await waitFor(()=>expect(p.onClose).toHaveBeenCalled());expect(p.onSaved).toHaveBeenCalledWith('SO-TEST','new memo',99);expect(p.journal.acknowledge).toHaveBeenCalledWith(receipt);
});
test('a failed cloud attempt retains its draft and reuses the request identity when retried',async()=>{
 const p=setup({saveCommand:jest.fn().mockRejectedValueOnce(new Error('Connection lost')).mockResolvedValue({saved:true,current_memo:'new memo',current_version:4})});await type();
 fireEvent.click(screen.getByText('Save memo'));await screen.findByText('Connection lost');expect(p.journal.acknowledge).not.toHaveBeenCalled();
 fireEvent.click(screen.getByText('Save memo'));await waitFor(()=>expect(p.onClose).toHaveBeenCalled());
 expect(p.saveCommand.mock.calls[0][0].requestId).toBe(p.saveCommand.mock.calls[1][0].requestId);
});
test('same-field conflicts display both texts and overwrite requires an explicit new command',async()=>{
 const p=setup({saveCommand:jest.fn().mockResolvedValueOnce({saved:false,conflict:true,current_memo:'someone else',current_version:4}).mockResolvedValue({saved:true,current_memo:'new memo',current_version:5})});await type();
 fireEvent.click(screen.getByText('Save memo'));await screen.findByText('someone else');expect(screen.getByLabelText('Your memo').value).toBe('new memo');expect(p.saveCommand).toHaveBeenCalledTimes(1);
 fireEvent.click(screen.getByText('Use my memo instead'));await waitFor(()=>expect(p.onClose).toHaveBeenCalled());
 expect(p.saveCommand.mock.calls[1][0].expectedMemo).toBe('someone else');expect(p.saveCommand.mock.calls[1][0].requestId).not.toBe(p.saveCommand.mock.calls[0][0].requestId);
});
test('a lost-response receipt reports the current memo if another edit has since committed',async()=>{
 const p=setup({saveCommand:jest.fn().mockResolvedValue({saved:true,replayed:true,memo:'new memo',current_memo:'later edit',current_version:8})});await type();fireEvent.click(screen.getByText('Save memo'));
 await waitFor(()=>expect(p.onSaved).toHaveBeenCalledWith('SO-TEST','later edit',8));
});
test('failed local storage blocks closing unsaved work but still permits a successful online save',async()=>{
 const error=new Error('Quota');error.draftReceipt=receipt;
 const p=setup({journal:{stage:jest.fn().mockRejectedValue(error),acknowledge:jest.fn().mockRejectedValue(error)}});
 fireEvent.change(screen.getByLabelText('Your memo'),{target:{value:'new memo'}});await screen.findByRole('alert');
 expect(screen.getByText('Close and keep draft').disabled).toBe(true);fireEvent.click(screen.getByText('Save memo'));
 await waitFor(()=>expect(p.onClose).toHaveBeenCalled());expect(p.onSaved).toHaveBeenCalled();
});
test('recovered drafts are acknowledged by exact revision along with the new save attempt',async()=>{
 const recovered={key:'old-lane',owner:'staff',revision:'old-revision'};
 const p=setup({initial:{...initial,memo:'recovered memo',_draftRecovery:recovered}});fireEvent.click(screen.getByText('Save memo'));
 await waitFor(()=>expect(p.onClose).toHaveBeenCalled());expect(p.journal.acknowledge.mock.calls).toEqual([[receipt],[recovered]]);
});
test('closing keeps the draft; explicit discard removes it without a cloud write',async()=>{
 const p=setup();await type();fireEvent.click(screen.getByText('Close and keep draft'));expect(p.journal.acknowledge).not.toHaveBeenCalled();expect(p.saveCommand).not.toHaveBeenCalled();
 fireEvent.click(screen.getByText('Discard memo draft'));await waitFor(()=>expect(p.journal.acknowledge).toHaveBeenCalledWith(receipt));expect(p.saveCommand).not.toHaveBeenCalled();
});

test('inline memo saves on Enter without opening a modal or changing the command contract',async()=>{
 const host=document.createElement('div');document.body.appendChild(host);
 const p=setup({inlineTarget:host});
 expect(screen.queryByRole('dialog')).toBeNull();
 fireEvent.change(screen.getByLabelText('Your memo'),{target:{value:'new memo'}});
 await screen.findByText('Not saved · draft kept here');
 fireEvent.keyDown(screen.getByLabelText('Your memo'),{key:'Enter'});
 await waitFor(()=>expect(p.onClose).toHaveBeenCalled());
 expect(p.saveCommand).toHaveBeenCalledWith(expect.objectContaining({id:'SO-TEST',memo:'new memo',expectedMemo:'old memo'}));
 host.remove();
});

test('moving between an inline field and recovery dialog preserves text and retry identity',async()=>{
 const host=document.createElement('div');document.body.appendChild(host);
 const props={initial,owner:'staff',saveCommand:jest.fn().mockRejectedValue(new Error('Offline')),onSaved:jest.fn(),onClose:jest.fn(),journal:{stage:jest.fn().mockResolvedValue(receipt),acknowledge:jest.fn()}};
 const view=render(<OrderMemoDialog {...props} inlineTarget={host}/>);
 fireEvent.change(screen.getByLabelText('Your memo'),{target:{value:'keep across navigation'}});
 await screen.findByText('Not saved · draft kept here');
 fireEvent.click(screen.getByText('Save memo'));await screen.findByText('Offline');
 const request=props.saveCommand.mock.calls[0][0].requestId;
 view.rerender(<OrderMemoDialog {...props}/>);
 expect(screen.getByRole('dialog')).toBeTruthy();
 expect(screen.getByLabelText('Your memo').value).toBe('keep across navigation');
 view.rerender(<OrderMemoDialog {...props} inlineTarget={host}/>);
 expect(screen.queryByRole('dialog')).toBeNull();
 expect(screen.getByLabelText('Your memo').value).toBe('keep across navigation');
 fireEvent.click(screen.getByText('Save memo'));
 await waitFor(()=>expect(props.saveCommand).toHaveBeenCalledTimes(2));
 expect(props.saveCommand.mock.calls[1][0].requestId).toBe(request);
 host.remove();
});
