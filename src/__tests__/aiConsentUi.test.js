import React from 'react';
import {render,screen,fireEvent,waitFor} from '@testing-library/react';
import ChatWidget from '../teamshop/ChatWidget';
jest.mock('../teamshop/useCoachSession',()=>()=>({signedIn:false,accessToken:null}));
beforeEach(()=>{sessionStorage.clear();global.fetch=jest.fn().mockResolvedValue({ok:true,json:async()=>({ok:true,text:'AI response',cards:[]})});});
afterEach(()=>{delete global.fetch;});
test('no transcript is sent before consent; allowing resumes the pending question',async()=>{
 render(<ChatWidget/>);fireEvent.click(screen.getByLabelText('Open Team Shop Assistant chat'));
 fireEvent.change(screen.getByLabelText('Message'),{target:{value:'Hello'}});fireEvent.keyDown(screen.getByLabelText('Message'),{key:'Enter'});
 expect(global.fetch).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'Allow AI assistance'}));
 await waitFor(()=>expect(global.fetch).toHaveBeenCalledTimes(1));
 expect(JSON.parse(global.fetch.mock.calls[0][1].body).ai_consent.accepted).toBe(true);
 fireEvent.click(screen.getByRole('button',{name:'Turn off AI'}));
 fireEvent.change(screen.getByLabelText('Message'),{target:{value:'Again'}});fireEvent.keyDown(screen.getByLabelText('Message'),{key:'Enter'});
 expect(global.fetch).toHaveBeenCalledTimes(1);
});
test('declining uses the local reply path without calling Anthropic',()=>{
 render(<ChatWidget/>);fireEvent.click(screen.getByLabelText('Open Team Shop Assistant chat'));
 fireEvent.change(screen.getByLabelText('Message'),{target:{value:'sizing help'}});fireEvent.keyDown(screen.getByLabelText('Message'),{key:'Enter'});
 fireEvent.click(screen.getByRole('button',{name:'Continue without AI'}));expect(global.fetch).not.toHaveBeenCalled();expect(screen.getByText('Adult fit guide — chest')).toBeTruthy();
});
