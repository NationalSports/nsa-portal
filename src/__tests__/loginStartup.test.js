import React from 'react';
import {render,screen,act,fireEvent} from '@testing-library/react';
import LoginGate from '../LoginGate';
jest.mock('../constants',()=>({NSA:{logoUrl:'logo.png'}}));
const props=()=>({onLogin:jest.fn(),reps:[],sbGetSession:jest.fn().mockResolvedValue(null),sbGetMyProfile:jest.fn().mockResolvedValue(null)});
afterEach(()=>jest.useRealTimers());
test('session restoration timeout releases the loading screen',async()=>{
 jest.useFakeTimers();const p=props();p.sbGetSession.mockReturnValue(new Promise(()=>{}));render(<LoginGate {...p}/>);
 await act(async()=>{jest.advanceTimersByTime(20000)});
 expect(screen.getByText(/Restoring your session took too long/)).toBeTruthy();expect(screen.getByRole('button',{name:'Sign In'})).toBeTruthy();expect(p.onLogin).not.toHaveBeenCalled();
});
test('rejected session restoration shows sign-in instead of hanging',async()=>{
 const p=props();p.sbGetSession.mockRejectedValue(new Error('network unavailable'));render(<LoginGate {...p}/>);
 expect(await screen.findByText('network unavailable')).toBeTruthy();
});
test('unmounted restoration never logs in with a late profile',async()=>{
 let resolve;const p=props();p.sbGetSession.mockReturnValue(new Promise(r=>{resolve=r}));p.sbGetMyProfile.mockResolvedValue({id:'user'});
 const view=render(<LoginGate {...p}/>);await act(async()=>{});view.unmount();await act(async()=>{resolve({user:{id:'auth'}})});expect(p.onLogin).not.toHaveBeenCalled();
});
test.each(['authentication','profile'])('hung %s releases the sign-in button with a phase error',async phase=>{
 jest.useFakeTimers();const p=props();p.sbSignIn=jest.fn().mockResolvedValue({user:{id:'u'}});
 if(phase==='authentication')p.sbSignIn.mockReturnValue(new Promise(()=>{}));
 else p.sbGetMyProfile.mockReturnValue(new Promise(()=>{}));
 render(<LoginGate {...p}/>);await act(async()=>{});
 fireEvent.change(screen.getByPlaceholderText('you@example.com'),{target:{value:'test@example.com'}});
 fireEvent.change(screen.getByPlaceholderText('Enter password'),{target:{value:'test-password'}});
 await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'Sign In'}))});
 await act(async()=>{jest.advanceTimersByTime(20000)});
 expect(screen.getByText(phase==='authentication'?/Signing in took too long/:/Loading your staff profile took too long/)).toBeTruthy();
 expect(screen.getByRole('button',{name:'Sign In'}).disabled).toBe(false);expect(p.onLogin).not.toHaveBeenCalled();
});

test('profile lookup rejection is shown without attempting an account link',async()=>{
 const p=props();p.sbSignIn=jest.fn().mockResolvedValue({user:{id:'u'}});
 p.sbGetMyProfile.mockRejectedValue(new Error('Could not load your staff profile: request failed'));
 p.sbLinkTeamAuth=jest.fn();p.reps=[{id:'team',email:'test@example.com',is_active:true}];
 render(<LoginGate {...p}/>);await act(async()=>{});
 fireEvent.change(screen.getByPlaceholderText('you@example.com'),{target:{value:'test@example.com'}});
 fireEvent.change(screen.getByPlaceholderText('Enter password'),{target:{value:'test-password'}});
 await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'Sign In'}))});
 expect(screen.getByText('Could not load your staff profile: request failed')).toBeTruthy();
 expect(p.sbLinkTeamAuth).not.toHaveBeenCalled();expect(p.onLogin).not.toHaveBeenCalled();
});
test('linking requires a server profile before completing sign-in',async()=>{
 const p=props();p.sbSignIn=jest.fn().mockResolvedValue({user:{id:'u'}});
 p.sbLinkTeamAuth=jest.fn().mockResolvedValue();p.reps=[{id:'team',email:'test@example.com',is_active:true}];
 render(<LoginGate {...p}/>);await act(async()=>{});
 fireEvent.change(screen.getByPlaceholderText('you@example.com'),{target:{value:'test@example.com'}});
 fireEvent.change(screen.getByPlaceholderText('Enter password'),{target:{value:'test-password'}});
 await act(async()=>{fireEvent.click(screen.getByRole('button',{name:'Sign In'}))});
 expect(screen.getByText(/could not be verified after linking/)).toBeTruthy();
 expect(p.sbLinkTeamAuth).toHaveBeenCalledWith('team','u');expect(p.onLogin).not.toHaveBeenCalled();
});
