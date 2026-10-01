const crypto = require('crypto');
const { corsHeaders, verifyUser } = require('./_shared');
const { accessTokenForLink } = require('./_repGoogle');
const { gmailFetch, getMessage, parseMessage, buildMime } = require('./_gmailAi');
const json = (statusCode, body) => ({statusCode, headers: corsHeaders(), body: JSON.stringify(body)});
const escape = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const headersOf = message => Object.fromEntries((message.payload?.headers||[]).map(h=>[h.name.toLowerCase(),h.value]));
const address = s => String(s||'').match(/<([^>]+)>/)?.[1] || String(s||'').trim();
const proof = (owner, insight, draft) => crypto.createHmac('sha256',process.env.GOOGLE_TOKEN_ENC_KEY).update(JSON.stringify([owner,insight,draft])).digest('hex');
exports.handler = async event => {
  if(event.httpMethod==='OPTIONS')return json(204,{});
  if(event.httpMethod!=='POST')return json(405,{error:'POST only'});
  const auth=await verifyUser(event); if(!auth.ok)return json(auth.status,{error:auth.error});
  let body; try{body=JSON.parse(event.body||'{}')}catch{return json(400,{error:'Invalid JSON'})}
  if(!['prepare','draft','send'].includes(body.action))return json(400,{error:'Unknown action'});
  if(Buffer.byteLength(event.body||'')>100000)return json(413,{error:'Reply is too long'});
  const {data:row,error}=await auth.admin.from('rep_email_insights').select('id,gmail_message_id').eq('id',body.insightId).eq('team_member_id',auth.teamMemberId).maybeSingle();
  if(error)return json(500,{error:'Could not load email'});
  if(!row)return json(404,{error:'Email not found'});
  const {data:link,error:linkError}=await auth.admin.from('rep_google_links').select('*').eq('team_member_id',auth.teamMemberId).maybeSingle();
  if(linkError||!link)return json(400,{error:'Connect Google first'});
  try{
    const token=await accessTokenForLink(auth.admin,link);
    if(body.action==='send'){
      if(!body.draftId||body.proof!==proof(auth.teamMemberId,row.id,body.draftId))return json(400,{error:'Save a reply draft first'});
      // Gmail consumes this exact draft on send; a retry cannot create a second message.
      const sent=await gmailFetch(token,'/drafts/send',{method:'POST',body:JSON.stringify({id:body.draftId})});
      return json(200,{sent:true,messageId:sent.id});
    }
    const original=await getMessage(token,row.gmail_message_id);
    const h=headersOf(original), parsed=parseMessage(original);
    const to=address(h['reply-to']||h.from);
    if(!/^[^\s@<>;,\r\n]+@[^\s@<>;,\r\n]+\.[^\s@<>;,\r\n]+$/.test(to))return json(400,{error:'Open Gmail to reply to this sender'});
    const alias=await gmailFetch(token,'/settings/sendAs/'+encodeURIComponent(link.google_email));
    const signature=alias.signature||'';
    const subject=/^re:/i.test(h.subject||'')?h.subject:'Re: '+(h.subject||'');
    if(body.action==='prepare')return json(200,{to,from:link.google_email,subject,signature,originalText:parsed.text_body||parsed.snippet||''});
    if(typeof body.text!=='string'||!body.text.trim()||body.text.length>20000)return json(400,{error:'Write a reply of up to 20,000 characters'});
    if(!signature)return json(400,{error:'No Gmail signature found. Set your signature in Gmail before saving this reply.'});
    const html='<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.6">'+escape(body.text).replace(/\n/g,'<br>')+'</div><br>'+signature;
    const raw=Buffer.from(buildMime({from:link.google_email,to,subject,text:body.text,html,inReplyTo:h['message-id'],references:[h.references,h['message-id']].filter(Boolean).join(' ')})).toString('base64url');
    const message={raw,threadId:original.threadId};
    let draft;
    if(body.draftId&&body.proof===proof(auth.teamMemberId,row.id,body.draftId))draft=await gmailFetch(token,'/drafts/'+encodeURIComponent(body.draftId),{method:'PUT',body:JSON.stringify({message})});
    else draft=await gmailFetch(token,'/drafts',{method:'POST',body:JSON.stringify({message})});
    return json(200,{draftId:draft.id,proof:proof(auth.teamMemberId,row.id,draft.id),signature});
  }catch(e){return json(502,{error:body.action==='send'?'Send could not be confirmed. Check Gmail Sent before trying again. '+e.message:e.message})}
};
