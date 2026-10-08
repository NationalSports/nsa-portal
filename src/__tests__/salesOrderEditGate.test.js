import React from 'react';
import {createRoot} from 'react-dom/client';
import {act} from 'react-dom/test-utils';
import SalesOrderEditGate from '../SalesOrderEditGate';
import {loadRecoveryDocument} from '../lib/loadRecoveryDocument';
jest.mock('../lib/loadRecoveryDocument',()=>({loadRecoveryDocument:jest.fn()}));
let root,host,client,saved,latest,owner;
const stale={id:'SO-1',memo:'old',items:[{sku:'OLD',sizes:{M:1}}]};
const fresh={id:'SO-1',memo:'fresh',items:[{sku:'NEW',sizes:{M:2}}],_version:4};
function Editor(props){latest=props;return <button onClick={()=>props.onSaveNow({...props.order,memo:'edited'})}>Save edit</button>}
const render=async extra=>{await act(async()=>root.render(<React.StrictMode><SalesOrderEditGate enabled editor={Editor} supabase={client} order={stale} cu={{id:'steve'}} onSaveNow={saved} onBack={jest.fn()} {...extra}/></React.StrictMode>));};
const click=async label=>{const b=[...host.querySelectorAll('button')].find(b=>b.textContent===label);expect(b).toBeTruthy();await act(async()=>b.dispatchEvent(new MouseEvent('click',{bubbles:true})));};
beforeEach(()=>{global.crypto=require('crypto').webcrypto;global.IS_REACT_ACT_ENVIRONMENT=true;host=document.createElement('div');document.body.appendChild(host);root=createRoot(host);saved=jest.fn().mockResolvedValue(true);latest=null;owner=localStorage.getItem('nsa_user');localStorage.setItem('nsa_user',JSON.stringify({id:'steve'}));client={rpc:jest.fn(async()=>({data:{owned:true,generation:1,ttl_ms:120000}}))};loadRecoveryDocument.mockResolvedValue({row:fresh,token:'fresh-token'});});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();if(owner)localStorage.setItem('nsa_user',owner);else localStorage.removeItem('nsa_user');jest.clearAllMocks();});
test('view-only does not mount editor or write; StrictMode still allows explicit editing',async()=>{
 await render();expect(latest).toBeNull();expect(client.rpc).not.toHaveBeenCalled();expect(host.textContent).toContain('OLD');
 await click('Edit order');expect(latest.order.memo).toBe('fresh');await click('Save edit');
 expect(saved.mock.calls[0][0]).toMatchObject({memo:'edited',_version:4,_editLease:{generation:1}});
});
test('competing owner leaves order readable with no editor or save callback',async()=>{
 client.rpc.mockResolvedValue({data:{owned:false,holder:'Gayle',generation:3,can_takeover:false}});
 await render();await click('Edit order');expect(host.textContent).toContain('Gayle is editing');expect(latest).toBeNull();expect(saved).not.toHaveBeenCalled();
});
test('failed full read never opens a partially hydrated editor',async()=>{
 loadRecoveryDocument.mockRejectedValue(new Error('incomplete'));await render();await click('Edit order');expect(latest).toBeNull();expect(host.textContent).toContain('incomplete');
});
test('takeover notification freezes mounted editor and blocks a retained callback',async()=>{
 const preserve=jest.fn().mockResolvedValue({});const ref={current:null};await render({recoveryEditorRef:ref});await click('Edit order');
 ref.current={preserve};const previous=latest;await act(async()=>window.dispatchEvent(new CustomEvent('nsa:edit-lease-lost',{detail:{id:'SO-1',session:latest.order._editLease.session}})));
 expect(host.querySelector('[inert]')).toBeTruthy();expect(previous.onSaveNow({...fresh,memo:'late'})).toBe(false);expect(saved).not.toHaveBeenCalled();expect(preserve).toHaveBeenCalled();
});

test('disabled rollout preserves the existing editor and makes no lease request',async()=>{
 await render({enabled:false});expect(latest.order).toBe(stale);expect(client.rpc).not.toHaveBeenCalled();
});
