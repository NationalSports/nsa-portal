const {verifyUserOrInternal,corsHeaders}=require('./_shared');
function sectionHandler(handler,pages){
 return async (event,context)=>{
  if(event.httpMethod==='OPTIONS')return {statusCode:204,headers:corsHeaders(),body:''};
  try{const auth=await verifyUserOrInternal(event,pages);if(!auth.ok)return {statusCode:auth.status||403,headers:corsHeaders(),body:JSON.stringify({error:auth.error||'Access denied'})};return handler(event,context);}
  catch(e){console.error('[section authorization]',e.message);return {statusCode:503,headers:corsHeaders(),body:JSON.stringify({error:'Could not verify section access'})};}
 };
}
module.exports={sectionHandler};
