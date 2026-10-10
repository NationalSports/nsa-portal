// Clear company caches before changing principal or permissions on a shared device.
export function acceptStaffProfile(profile,storage=localStorage){
 const fingerprint=JSON.stringify([profile.auth_id||profile.id,profile.role,profile.access,profile.is_active]);
 const prior=storage.getItem('nsa_cache_owner');
 if(prior!==fingerprint){
  const keys=[];for(let i=0;i<storage.length;i++){const key=storage.key(i);if(key?.startsWith('nsa_')&&!['nsa_mobile_mode'].includes(key))keys.push(key);}
  keys.forEach(key=>storage.removeItem(key));
 }
 storage.setItem('nsa_cache_owner',fingerprint);
 return prior!==fingerprint;
}
