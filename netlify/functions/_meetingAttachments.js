const {randomUUID}=require('crypto');
const BUCKET='meeting-images';
const LIMIT=6;
function annotations(input) {
  return (Array.isArray(input)?input:[]).slice(0,100).map(a=>({at_ms:Math.max(0,Math.min(6*3600*1000,Number(a.at_ms)||0)),text:String(a.text||'').trim().slice(0,500),kind:a.kind==='highlight'?'highlight':'text'})).filter(a=>a.text);
}
async function imageAction(admin,m,action,body) {
  const files=m.attachments||[];
  if(action==='image_upload') {
    if(files.length>=LIMIT)throw new Error('A note can hold up to six photos.');
    const mime=String(body.mime||''); const exts={'image/jpeg':'jpg','image/png':'png','image/webp':'webp'};
    if(!exts[mime])throw new Error('Use a JPEG, PNG or WebP photo.');
    const path=`${m.team_member_id}/${m.id}/${randomUUID()}.${exts[mime]}`;
    const entry={path,mime,name:String(body.name||'Photo').slice(0,120),pending:true};
    const signed=await admin.storage.from(BUCKET).createSignedUploadUrl(path);
    if(signed.error)throw new Error(signed.error.message);
    const {data,error}=await admin.from('meetings').update({attachments:[...files,entry],updated_at:new Date().toISOString()}).eq('id',m.id).eq('updated_at',m.updated_at).eq('status','recording').select('id').maybeSingle();
    if(error||!data)throw new Error('The note changed. Refresh before adding a photo.');
    return {path,token:signed.data.token};
  }
  if(action==='image_remove') {
    const entry=files.find(f=>f.path===body.path);if(!entry)throw new Error('Photo not found.');
    const {error}=await admin.storage.from(BUCKET).remove([entry.path]);if(error)throw new Error(error.message);
    const {data:saved,error:e}=await admin.from('meetings').update({attachments:files.filter(f=>f.path!==entry.path),updated_at:new Date().toISOString()}).eq('id',m.id).eq('updated_at',m.updated_at).eq('status','recording').select('id').maybeSingle();
    if(e||!saved)throw new Error('Note changed. Retry removing the photo.');return {ok:true};
  }
  if(action==='image_commit') {
    const entry=files.find(f=>f.path===body.path);if(!entry)throw new Error('Photo not found on this note.');
    const {data,error}=await admin.storage.from(BUCKET).download(entry.path);
    if(error)throw new Error('Photo upload has not finished.');
    const bytes=Buffer.from(await data.arrayBuffer());
    const valid=entry.mime==='image/jpeg'?bytes[0]===255&&bytes[1]===216:entry.mime==='image/png'?bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP';
    if(!valid||bytes.length>1048576) {await admin.storage.from(BUCKET).remove([entry.path]);throw new Error('Photo is invalid or exceeds 1 MB.');}
    const {data:saved,error:e}=await admin.from('meetings').update({attachments:files.map(f=>f.path===entry.path?{...f,pending:false,bytes:bytes.length}:f),updated_at:new Date().toISOString()}).eq('id',m.id).eq('updated_at',m.updated_at).eq('status','recording').select('id').maybeSingle();
    if(e||!saved)throw new Error('The note changed. Refresh and retry the photo.');
    return {ok:true};
  }
  return null;
}
async function purgeImages(admin,m) {
  const {data,error}=await admin.storage.from(BUCKET).list(`${m.team_member_id}/${m.id}`,{limit:100});
  if(error)throw new Error(error.message);
  if(data?.length){const r=await admin.storage.from(BUCKET).remove(data.map(f=>`${m.team_member_id}/${m.id}/${f.name}`));if(r.error)throw new Error(r.error.message);}
}
async function imagesForModel(admin,m) {
  const out=[];
  for(const f of (m.attachments||[]).filter(f=>!f.pending)){
    const {data,error}=await admin.storage.from(BUCKET).download(f.path);if(error)throw new Error('Could not read an attached photo.');
    const bytes=Buffer.from(await data.arrayBuffer());if(bytes.length>1048576)throw new Error('Photo exceeds limit.');
    out.push({type:'image',source:{type:'base64',media_type:f.mime,data:bytes.toString('base64')}});
  }
  return out;
}
module.exports={annotations,imageAction,purgeImages,imagesForModel,BUCKET};
