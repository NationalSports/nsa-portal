// Production identity excludes conversation, refresh timestamps and UI-only aliases.
export function productionContent(p) {
 const clean=rows=>(rows||[]).map(({legacyIds,specReady,...row})=>row);
 return {store:p.store,salesOrders:p.salesOrders,garments:clean(p.garments),decorations:clean(p.decorations),players:clean(p.players),notes:p.notes,dpo:p.dpo ? {id:p.dpo.id,soId:p.dpo.soId,number:p.dpo.number,expectedDate:p.dpo.expectedDate} : null};
}
export const WORKFLOW_LABELS={received:'Garments received',hold:'Production hold',in_production:'In production',complete:'Production complete',acknowledged:'Revision reviewed'};
export function workflowMessage(body,packet) {
 const status=body.workflow_status;
 if(!WORKFLOW_LABELS[status])throw new Error('Choose a production update.');
 const soId=String(body.target_so_id||'');
 const total=(packet.garments||[]).filter(g=>g.soId===soId).reduce((n,g)=>n+g.units,0);
 const quantity=body.quantity===''||body.quantity==null?null:Number(body.quantity);
 if(status!=='acknowledged' && (!Number.isInteger(quantity)||quantity<0||quantity>total))throw new Error(`Enter a whole garment quantity between 0 and ${total}.`);
 if(['received','in_production','complete'].includes(status)&&quantity===0)throw new Error('Enter the garment quantity covered by this update.');
 const detail=String(body.text||'').trim();
 if(status==='hold'&&!detail)throw new Error('Describe the hold so the SO team can resolve it.');
 if(detail.length>8000)throw new Error('Keep production updates under 8,000 characters.');
 return {metadata:{type:'production_update',status,quantity,total,fingerprint:packet.fingerprint,dpoId:packet.dpo?.id||null},text:`${WORKFLOW_LABELS[status]}${status==='acknowledged'?'':` — ${quantity} of ${total} garments`}${packet.dpo?` · ${packet.dpo.number}`:''}\nProduction version ${packet.fingerprint.slice(0,12)}${detail?`\n${detail}`:''}`};
}
export function groupConversations(messages=[]) {
 const sorted=[...messages].sort((a,b)=>(Date.parse(a.ts)||0)-(Date.parse(b.ts)||0)||a.id.localeCompare(b.id));
 const byId=new Map(sorted.map(m=>[m.id,m]));
 const root=m=>{const seen=new Set([m.id]);while(m.threadId&&byId.has(m.threadId)&&!seen.has(m.threadId)){seen.add(m.threadId);m=byId.get(m.threadId);}return m.id;};
 const groups=new Map();sorted.forEach(m=>{const id=root(m);if(!groups.has(id))groups.set(id,[]);groups.get(id).push(m);});return [...groups].map(([id,rows])=>({id,rows}));
}
export function groupProductionRuns(packet) {
 const groups=new Map();
 for(const d of packet.decorations||[]) {
  if(d.isPersonalization||['names','numbers'].includes(d.kind))continue;
  // File identity, colorway and all setup specs must match before combining runs.
  const key=JSON.stringify([d.name,d.method,d.position,d.dimensions,d.colors,d.pantoneColors,d.threadColors,d.stitches,d.decorator,d.productionFiles]);
  if(!groups.has(key))groups.set(key,{id:d.id,name:d.name,method:d.method,position:d.position,dimensions:d.dimensions,colors:d.threadColors||d.pantoneColors||d.colors,decorations:[],units:0});
  const run=groups.get(key);run.decorations.push(d);run.units+=d.units;
 }
 return [...groups.values()];
}
export function packetForRun(packet,run) {
 const ids=new Set(run.decorations.map(d=>d.id)),gids=new Set(run.decorations.map(d=>d.garmentId));
 const garments=packet.garments.filter(g=>gids.has(g.id)).map(g=>({...g,decorationIds:g.decorationIds.filter(id=>ids.has(id))}));
 return {...packet,garments,decorations:run.decorations,players:[],messages:[],notes:packet.notes.filter(n=>!n.targetId||gids.has(n.targetId)||ids.has(n.targetId)),totals:{...packet.totals,garments:garments.reduce((n,g)=>n+g.units,0),orders:0,players:0,playerUnits:0,unbatchedUnits:0}};
}
export function personalizationCsv(packet) {
 const cell=v=>'"'+String(v??'').replace(/^[=+@\-\t\r]/,"'$&").replace(/"/g,'""')+'"';
 const rows=[['SO','Garment','Garment color','Size','Print text (exact)','Placement','Method','Font','Dimensions','Print/thread color','Quantity']];
 for(const d of packet.decorations.filter(d=>['names','numbers'].includes(d.kind)))for(const r of d.personalization.roster||[])rows.push([d.soId,d.sku,d.color,r.size,d.kind==='names'?r.name:r.number,d.position,d.method,d.personalization.font,d.dimensions,d.colors,r.qty]);
 return '\ufeff'+rows.map(row=>row.map(cell).join(',')).join('\r\n');
}
