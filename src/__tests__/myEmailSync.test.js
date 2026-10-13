import React from 'react';
import {render,screen,waitFor,fireEvent,act} from '@testing-library/react';
import MyEmail from '../MyEmail';
jest.mock('../components',()=>({Icon:()=>null,SearchSelect:()=>null}));
jest.mock('../CustomerEmailReply',()=>()=>null);
jest.mock('../CustomerEmailWork',()=>()=>null);
jest.mock('../utils/rememberEmailSender',()=>({rememberEmailSender:jest.fn()}));
const owner='rep-2';
function setup(syncResult={analyzed:1,skipped:0}){
 const query={select:()=>query,eq:jest.fn(()=>query),neq:()=>query,order:()=>query,limit:async()=>({data:[]})};
 const supabase={auth:{getSession:async()=>({data:{session:{access_token:'test'}}})},from:()=>query};
 global.fetch=jest.fn(async(url)=>({ok:!(syncResult.error&&url.endsWith('rep-gmail-sync')),json:async()=>url.endsWith('google-connect')?{connected:true,google_email:'rep@example.com'}:syncResult}));
 render(<MyEmail supabase={supabase} cu={{id:owner}} customers={[]}/>);
 return query;
}
afterEach(()=>{jest.useRealTimers();delete global.fetch;});
test('connected reps check immediately, show failure honestly and stay owner scoped',async()=>{
 const query=setup({error:'Google access expired'});
 await screen.findByText('Email check failed: Google access expired');
 expect(global.fetch.mock.calls.filter(([u])=>u.endsWith('rep-gmail-sync'))).toHaveLength(1);
 expect(query.eq).toHaveBeenCalledWith('team_member_id',owner);
 expect(screen.getByText('The last check failed. Previously imported conversations remain below.')).toBeTruthy();
 expect(screen.queryByText(/0 customer emails added/)).toBeNull();
});
test('visibility does not duplicate recent checks, but catches up after a minute',async()=>{
 setup();await waitFor(()=>expect(global.fetch.mock.calls.filter(([u])=>u.endsWith('rep-gmail-sync'))).toHaveLength(1));
 await screen.findByText(/1 customer email added/);
 fireEvent(document,new Event('visibilitychange'));
 expect(global.fetch.mock.calls.filter(([u])=>u.endsWith('rep-gmail-sync'))).toHaveLength(1);
 const now=jest.spyOn(Date,'now').mockReturnValue(Date.now()+61000);
 await act(async()=>{fireEvent(document,new Event('visibilitychange'));});
 expect(global.fetch.mock.calls.filter(([u])=>u.endsWith('rep-gmail-sync'))).toHaveLength(2);
 now.mockRestore();
});
