import {loadAllQBEntities,queryQBReadOnly} from './qbAccountMappings';
const clean=v=>String(v||'').trim();
const email=v=>clean(v).toLowerCase();
const signature=r=>JSON.stringify([r.realmId,r.sourceId,r.previousId,r.targetId,r.targetName,r.email,r.termId,r.oldStatus]);

// Explicit link-only repair. Never invokes a QBO write endpoint.
export async function reviewCustomerLinkRepair({qbApi,qbConfig,customers,invoices=[],salesOrders=[],customerId,targetId}){
  const realmId=clean(qbConfig.realm_id);
  if(!realmId||qbConfig.preflight?.status!=='success'||clean(qbConfig.preflight.realm_id)!==realmId)throw new Error('Run the live preflight for this company first.');
  const c=customers.find(c=>clean(c.id)===clean(customerId));
  if(!c||c.is_active===false||c.deleted_at)throw new Error('Choose an active Portal customer.');
  const previousId=clean(qbConfig.custQBMap?.[c.id]||c.qb_customer_id);
  targetId=clean(targetId);
  if(!/^\d+$/.test(previousId)||!/^\d+$/.test(targetId)||previousId===targetId)throw new Error('Supply a different numeric QBO ID for an existing link.');
  if(c.qb_customer_id&&clean(c.qb_customer_id)!==targetId)throw new Error('Embedded customer ID requires a separate audit; no link changed.');
  if(customers.some(x=>clean(x.id)!==clean(c.id)&&(clean(qbConfig.custQBMap?.[x.id])===targetId||clean(x.qb_customer_id)===targetId)))throw new Error('Another Portal customer already claims the target ID.');
  if(invoices.some(i=>clean(i.customer_id)===clean(c.id)&&i.qb_invoice_id)||salesOrders.some(s=>clean(s.customer_id)===clean(c.id)&&qbConfig.qbSOMap?.[s.id]))throw new Error('This customer has linked transactions; audit those before relinking.');
  const read=async id=>(await queryQBReadOnly(qbApi,"SELECT * FROM Customer WHERE Id = '"+id+"' AND Active IN (true, false) MAXRESULTS 1",'customer link audit'))?.QueryResponse?.Customer?.[0];
  const old=await read(previousId);
  if(old&&old.Active!==false)throw new Error('The old QBO customer is still active; manual identity review is required.');
  const target=await read(targetId);
  if(!target||clean(target.Id)!==targetId||target.Active!==true)throw new Error('The replacement must be active and returned by QBO read-back.');
  const portalEmail=email(c.contact_email||c.contacts?.[0]?.email);
  if(!portalEmail||!portalEmail.includes('@')||portalEmail!==email(target.PrimaryEmailAddr?.Address))throw new Error('The primary contact email must match exactly.');
  const active=await loadAllQBEntities(qbApi,'Customer','Id, Active, PrimaryEmailAddr',1000);
  const matching=active.filter(x=>x.Active!==false&&email(x.PrimaryEmailAddr?.Address)===portalEmail);
  if(matching.length!==1||clean(matching[0].Id)!==targetId)throw new Error('The email is not unique in active QBO customers.');
  const terms=await loadAllQBEntities(qbApi,'Term','Id, Name, Active',1000);
  const term=terms.find(t=>t.Active!==false&&clean(t.Id)===clean(target.SalesTermRef?.value));
  if(!term)throw new Error('The target has no verified active QBO payment term.');
  return {realmId,sourceId:clean(c.id),customerName:c.name,previousId,targetId,targetName:target.DisplayName,email:portalEmail,termId:clean(term.Id),termName:term.Name,oldStatus:old?'inactive':'not returned'};
}
export async function applyCustomerLinkRepair(args,review,{approved=false,persistQbLink}={}){
  if(!approved||!review)throw new Error('Approve the reviewed link replacement first.');
  if(typeof persistQbLink!=='function')throw new Error('Durable link storage is unavailable.');
  const fresh=await reviewCustomerLinkRepair({...args,customerId:review.sourceId,targetId:review.targetId});
  if(signature(fresh)!==signature(review))throw new Error('The review changed; review and approve again.');
  const log={ts:new Date().toLocaleString(),type:'customer_link_repair',status:'success',details:[fresh.customerName+': Portal link #'+fresh.previousId+' → #'+fresh.targetId,'QBO unchanged; unique email and active term read back.']};
  await persistQbLink({mapKey:'custQBMap',sourceIds:[fresh.sourceId],qboId:fresh.targetId,expectedPreviousQboId:fresh.previousId,log,evidence:{result:'customer_link_repaired',api_readback:true,reviewer_approved:true,previous_qbo_id:fresh.previousId,old_status:fresh.oldStatus,target_name:fresh.targetName,term_id:fresh.termId,identity:'unique_primary_email'}});
  return fresh;
}
