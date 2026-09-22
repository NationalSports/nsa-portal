const fs=require('fs');const {execFileSync}=require('child_process');const {performance}=require('perf_hooks');
const current=fs.readFileSync('src/App.js','utf8');
const baseline=execFileSync('git',['show','caf8f317:src/App.js'],{encoding:'utf8',maxBuffer:20e6});
const helper=fs.readFileSync('src/lib/rowLookup.js','utf8').replace('export function','function');
const indexFirstById=Function(helper+';return indexFirstById')();
function measure(source,n){
 const rows=Array.from({length:n},(_,i)=>({id:'record-'+i,value:JSON.stringify({name:'Example '+i,items:[{sku:'SHIRT',sizes:{S:2,M:4,L:2}}]})}));
 const snap={current:{rows}};let writes=0;
 const body=source.match(/  const _diffSave=([^\n]+)/)[1];
 const run=Function('indexFirstById','_authErrorDetected','_initialLoadDone','_dbLoadSuccess','_diffSaveSkipLogged','_dbSnap','_dbSavePendingIds','_diffCmp','_bgSyncInc','_bgSyncDec','_hasActiveDocumentSave','_isDocumentConflictCooling','return '+body)(indexFirstById,false,{current:true},{current:true},new Set(),snap,new Set(),row=>row.value,()=>{},()=>{},()=>false,()=>false);
 const times=[];for(let i=0;i<3;i++){const t=performance.now();run(rows,'rows',()=>writes++);times.push(performance.now()-t)}
 if(writes)throw Error('Unexpected writes');return +times.sort((a,b)=>a-b)[1].toFixed(2);
}
const results=[5000,10000,20000].map(rows=>({rows,beforeMs:measure(baseline,rows),afterMs:measure(current,rows)}));
console.log(JSON.stringify({description:'Synthetic unchanged-record diff-save, median of 3 on local Node; not live browser latency',baseline:'caf8f317',node:process.version,results},null,2));
