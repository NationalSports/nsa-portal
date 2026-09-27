const crypto=require('crypto');
function photoBytes(photo) {
 if(!photo)return null;
 if(!['image/png','image/jpeg'].includes(photo.type)||typeof photo.content!=='string'||photo.content.length>2800000)throw new Error('Choose a PNG or JPEG photo under 2 MB.');
 const bytes=Buffer.from(photo.content,'base64');
 const valid=photo.type==='image/png'?bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
 if(!valid||bytes.length>2*1024*1024||bytes.length<12)throw new Error('The photo is not a valid PNG or JPEG under 2 MB.');
 return bytes;
}
async function uploadPhoto(admin,storeId,photo) {
 const bytes=photoBytes(photo);if(!bytes)return null;
 const path=`production-packet/${storeId}/${crypto.randomUUID()}.${photo.type==='image/png'?'png':'jpg'}`;
 const {error}=await admin.storage.from('artwork').upload(path,bytes,{contentType:photo.type,upsert:false});if(error)throw error;
 const {data}=admin.storage.from('artwork').getPublicUrl(path);
 return {path,attachment:{name:String(photo.name||'Production photo').slice(0,180),url:data.publicUrl,type:photo.type}};
}
module.exports={photoBytes,uploadPhoto};
