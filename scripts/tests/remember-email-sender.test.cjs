const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const source=fs.readFileSync(path.resolve(__dirname,'../../src/utils/rememberEmailSender.js'),'utf8');
const helper=import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
function db(initial, collision=false){
 const contacts=[...initial], inserts=[];
 return {contacts,inserts,from:table=>{
  assert.equal(table,'customer_contacts');
  return {select:()=>({eq:async(key,value)=>{assert.equal(key,'customer_id');assert.equal(value,'wvc');return {data:[...contacts]}}}),
   insert:async row=>{inserts.push(row);if(collision){collision=false;contacts.push({email:'other@example.com',sort_order:row.sort_order});return {error:{code:'23505'}}}contacts.push(row);return {}}};
 }};
}
test('adds normalized email after existing contacts without replacing them',async()=>{
 const api=db([{email:'existing@example.com',sort_order:2}]);
 await (await helper).rememberEmailSender(api,{customerId:'wvc',email:' KarlQWilson@gmail.com ',name:'Karl Wilson'});
 assert.equal(api.contacts.length,2);assert.equal(api.inserts[0].email,'karlqwilson@gmail.com');assert.equal(api.inserts[0].sort_order,3);
});
test('repeat saves recognize existing mixed-case email with whitespace',async()=>{
 const api=db([{email:' KarlQWilson@gmail.com ',sort_order:2}]);
 await (await helper).rememberEmailSender(api,{customerId:'wvc',email:'karlqwilson@gmail.com'});
 assert.equal(api.inserts.length,0);
});
test('concurrent contact insert retries with a fresh sort position',async()=>{
 const api=db([{email:'old@example.com',sort_order:0}],true);
 await (await helper).rememberEmailSender(api,{customerId:'wvc',email:'karlqwilson@gmail.com'});
 assert.deepEqual(api.inserts.map(r=>r.sort_order),[1,2]);
});
test('permission failures are surfaced instead of claiming the contact saved',async()=>{
 const api={from:()=>({select:()=>({eq:async()=>({error:{message:'Access denied'}})})})};
 await assert.rejects((await helper).rememberEmailSender(api,{customerId:'wvc',email:'karlqwilson@gmail.com'}),/Access denied/);
});
