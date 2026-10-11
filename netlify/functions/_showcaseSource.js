const crypto = require('crypto');
const sharp = require('sharp');
async function saveSupplierPhoto(admin, storeId, item, dataUrl) {
  if (!item?.product_id || item.kind === 'bundle') throw new Error('Choose a garment color');
  if (typeof dataUrl !== 'string' || dataUrl.length > 4200000 || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(dataUrl)) throw new Error('Choose a PNG, JPEG or WebP image up to 3 MB');
  const bytes = Buffer.from(dataUrl.split(',')[1],'base64');
  const image = sharp(bytes,{limitInputPixels:25000000});
  const metadata = await image.metadata();
  if (!['png','jpeg','webp'].includes(metadata.format) || metadata.width < 200 || metadata.height < 200) throw new Error('Use a garment photo at least 200 pixels wide and tall');
  const png = await image.rotate().resize({width:2000,height:2500,fit:'inside',withoutEnlargement:true}).png().toBuffer();
  const path = `${storeId}/supplier-photos/${crypto.randomUUID()}.png`;
  const bucket = admin.storage.from('showcase-images');
  const upload = await bucket.upload(path,png,{contentType:'image/png',upsert:false});
  if (upload.error) throw new Error(upload.error.message);
  const url = bucket.getPublicUrl(path).data?.publicUrl;
  if (!url) throw new Error('Photo URL unavailable');
  const result = await admin.from('webstore_products').update({supplier_image_url:url})
    .eq('store_id',storeId).eq('product_id',item.product_id);
  if (result.error) throw new Error(result.error.message);
  return url;
}
module.exports={saveSupplierPhoto};
