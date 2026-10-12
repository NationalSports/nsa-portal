const {getSupabaseAdmin,resolveCustomerFamily,verifyUser}=require('./_shared');
const {verifyCoach,coachHasCustomerAccess}=require('./_coachAuth');
// The tag is a routing key, never a credential. Resolve identities before fetching a family.
async function authorizeCoachPortal(event,admin,tag){
 const bearer=event.headers?.authorization||event.headers?.Authorization;
 if(!bearer?.startsWith('Bearer '))return {ok:false,status:401,error:'Please sign in to your coach account.'};
 // Staff previews need Customers access, even if the caller has an admin role.
 const staff=await verifyUser(event,['customers']);
 const signedCoach=staff.ok?null:await verifyCoach(admin,event);
 if(!staff.ok&&!signedCoach?.coach)return {ok:false,status:signedCoach?.status||403,error:signedCoach?.error||'Portal access denied'};
 const family=await resolveCustomerFamily(admin,tag);
 if(family.error)return {ok:false,status:family.notFound?404:503,error:'This portal could not be loaded.'};
 if(staff.ok)return {ok:true,fam:family.fam,staff:staff.profile};
 // Grant only explicitly authorized customer IDs. A child account cannot inherit siblings
 // through a parent tag. Membership of one family record is not a grant to all records.
 const allowed=new Set();
 for(const id of family.fam){const check=await coachHasCustomerAccess(admin,signedCoach.coach,id);if(check.error)return {ok:false,status:503,error:'Could not verify portal access'};if(check.ok)allowed.add(id);}
 if(!allowed.size)return {ok:false,status:403,error:'This account does not have access to this portal. Please contact your rep.'};
 return {ok:true,fam:allowed,coach:signedCoach.coach};
}
module.exports={authorizeCoachPortal};
