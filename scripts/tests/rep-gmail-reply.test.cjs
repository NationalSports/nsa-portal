const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');
const gmail=require('../../netlify/functions/_gmailAi');
function fixture({authorized=true,owned=true,signature='<table><tr><td>Steve Signature</td></tr></table>'}={}){
 const calls=[]; const original={id:'message1',threadId:'thread1',payload:{headers:[{name:'From',value:'Coach <coach@example.com>'},{name:'Reply-To',value:'reply@example.com'},{name:'Subject',value:'Uniform order'},{name:'Message-ID',value:'<original@example.com>'}],body:{data:Buffer.from('Need uniforms').toString('base64url')},mimeType:'text/plain'}};
 const admin={from:table=>({select:()=>({eq:(key,value)=>{
  if(table==='rep_google_links'){assert.equal(value,'owner');return {maybeSingle:async()=>({data:{google_email:'steve@example.com'}})}}
  return {eq:(key,owner)=>{assert.equal(key,'team_member_id');assert.equal(owner,'owner');return {maybeSingle:async()=>({data:owned?{id:'insight1',gmail_message_id:'message1'}:null})}}};
 }})})};
 const exports={};vm.runInNewContext(fs.readFileSync(require.resolve('../../netlify/functions/rep-gmail-reply'),'utf8'),{exports,Buffer,process:{env:{GOOGLE_TOKEN_ENC_KEY:'test-key'}},require:id=>{
  if(id==='./_repEmailSignature')return require('../../netlify/functions/_repEmailSignature');
  if(id==='crypto')return require('node:crypto');
  if(id==='./_shared')return {corsHeaders:()=>({}),verifyUser:async()=>authorized?{ok:true,admin,teamMemberId:'owner'}:{ok:false,status:401,error:'Unauthorized'}};
  if(id==='./_repGoogle')return {accessTokenForLink:async()=> 'test-token'};
  if(id==='./_gmailAi')return {...gmail,getMessage:async()=>original,gmailFetch:async(token,path,options)=>{calls.push({path,options});if(path.startsWith('/settings/'))return {signature};if(path==='/drafts/send')return {id:'sent1'};return {id:'draft1'}}};
  throw Error(id);
 }});
 return {calls,run:async body=>{const r=await exports.handler({httpMethod:'POST',body:JSON.stringify({insightId:'insight1',...body})});return {status:r.statusCode,data:JSON.parse(r.body)}}};
}
test('reply endpoint requires authentication and ownership',async()=>{
 for(const options of [{authorized:false},{owned:false}]){const f=fixture(options);const r=await f.run({action:'prepare'});assert.ok([401,404].includes(r.status));assert.equal(f.calls.length,0)}
});
test('prepare reads actual Gmail signature and honors original Reply-To',async()=>{
 const f=fixture();const r=await f.run({action:'prepare'});assert.equal(r.data.to,'reply@example.com');assert.match(r.data.signature,/Steve Signature/);assert.equal(f.calls.length,1);
});
test('draft escapes reply text, includes signature and preserves threading; only explicit send sends',async()=>{
 const f=fixture();const r=await f.run({action:'draft',text:'Hello <script>alert(1)</script>',to:'attacker@example.com'});
 assert.equal(r.status,200);assert.ok(!f.calls.some(c=>c.path==='/drafts/send'));
 const message=JSON.parse(f.calls.at(-1).options.body).message;const mime=Buffer.from(message.raw,'base64url').toString();
 assert.equal(message.threadId,'thread1');assert.match(mime,/To: reply@example.com/);assert.match(mime,/In-Reply-To: <original@example.com>/);assert.match(mime,/Steve Signature/);assert.match(mime,/&lt;script&gt;/);assert.doesNotMatch(mime,/attacker@example.com/);
 assert.equal((await f.run({action:'send',...r.data})).data.sent,true);
});
test('cannot send arbitrary drafts; missing signature blocks draft creation',async()=>{
 const f=fixture();assert.equal((await f.run({action:'send',draftId:'other',proof:'fake'})).status,400);assert.equal(f.calls.length,0);
 const g=fixture({signature:''});assert.equal((await g.run({action:'draft',text:'Hello'})).status,400);assert.ok(!g.calls.some(c=>c.path==='/drafts'));
});

test('Steve screenshot signature is used only for Steve when Gmail has none',()=>{
 const {signatureFor}=require('../../netlify/functions/_repEmailSignature');
 assert.match(signatureFor('steve@nationalsportsapparel.com',''),/714.791.8973/);
 assert.equal(signatureFor('other@example.com',''),'');
 assert.equal(signatureFor('steve@nationalsportsapparel.com','<b>Gmail</b>'),'<b>Gmail</b>');
});
