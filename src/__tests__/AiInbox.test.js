import React from 'react';
import {render,screen,fireEvent,waitFor} from '@testing-library/react';
import AiInbox from '../AiInbox';
jest.mock('../components',()=>({Icon:()=>null}));
jest.mock('../utils',()=>({createGmailDraft:jest.fn(),queueEmailCart:jest.fn()}));
const rows=[{id:'a',sender_email:'a@example.com',subject:'Broken request',status:'failed',error_message:'Unauthorized',received_at:'2026-07-27T12:00:00Z'}, {id:'b',sender_email:'b@example.com',subject:'Ready request',status:'needs_review',draft_body_text:'Original draft',received_at:'2026-07-26T12:00:00Z'}];
function setup(){
 const limit=jest.fn().mockResolvedValue({data:rows});
 const supabase={from:()=>({select:()=>({order:()=>({limit})})}), channel:()=>({on:()=>({subscribe:()=>({})})}),removeChannel:jest.fn()};
 render(<AiInbox supabase={supabase} customers={[]}/>);
 return {limit};
}
test('status filtering changes selection and failed processing is not shown as working',async()=>{
 setup();await screen.findByText('Analysis unavailable');
 expect(screen.queryByText('Proposed Gmail reply')).toBeNull();
 fireEvent.change(screen.getByLabelText('Request status'),{target:{value:'review'}});
 expect(screen.queryByText('Broken request')).toBeNull();
 expect(screen.getByRole('textbox',{name:'Search requests'})).toBeTruthy();
 expect(screen.getByDisplayValue('Original draft')).toBeTruthy();
 fireEvent.change(screen.getByLabelText('Search requests'),{target:{value:'nothing matches'}});
 expect(screen.queryByDisplayValue('Original draft')).toBeNull();
});
test('reload preserves unsaved reply edits',async()=>{
 const {limit}=setup();await screen.findByText('Analysis unavailable');
 fireEvent.change(screen.getByLabelText('Request status'),{target:{value:'review'}});
 fireEvent.change(screen.getByDisplayValue('Original draft'),{target:{value:'My unsaved reply'}});
 fireEvent.click(screen.getByText('Reload saved requests'));
 await waitFor(()=>expect(limit).toHaveBeenCalledTimes(2));
 await waitFor(()=>expect(screen.getByDisplayValue('My unsaved reply')).toBeTruthy());
});
