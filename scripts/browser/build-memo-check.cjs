// Build the real dialog with synthetic cloud responses and an isolated native
// IndexedDB journal. Serve the output on localhost; no ERP credentials or calls.
const fs=require('node:fs'),path=require('node:path'),babel=require('@babel/core');
const out=process.argv[2];if(!out||!out.startsWith('/private/tmp/'))throw new Error('Use an isolated /private/tmp output directory');
fs.mkdirSync(path.join(out,'lib'),{recursive:true});
const source=fs.readFileSync('src/OrderMemoDialog.js','utf8').replace(/import React,\{([^}]+)\} from 'react';/, 'const React=window.React;const {$1}=React;').replace("import {createPortal} from 'react-dom';", "const {createPortal}=window.ReactDOM;").replace("from './lib/draftJournal'","from './lib/draftJournal.js'");
fs.writeFileSync(path.join(out,'OrderMemoDialog.js'),babel.transformSync(source,{presets:[require.resolve('@babel/preset-react')],babelrc:false,configFile:false}).code);
fs.copyFileSync('src/lib/draftJournal.js',path.join(out,'lib/draftJournal.js'));
for(const pkg of ['react','react-dom'])fs.copyFileSync(path.join(path.dirname(require.resolve(pkg+'/package.json')),'umd',pkg+'.development.js'),path.join(out,pkg+'.js'));
fs.writeFileSync(path.join(out,'index.html'),`<!doctype html><meta charset="utf-8"><title>Memo command browser verification</title>
<style>body{font:16px system-ui;max-width:800px;margin:30px auto}button{padding:10px;margin:4px;cursor:pointer}textarea{display:block;width:95%;padding:12px;font:inherit}.modal{border:1px solid #aaa;border-radius:12px;padding:18px}p[role=alert]{color:#b91c1c}label{display:block;margin:10px 0}#status{background:#eff6ff;padding:12px}</style>
<h1>Memo command browser verification</h1><p>Synthetic cloud responses only. Recovery uses an isolated browser database.</p><div id="root"></div>
<script src="react.js"></script><script src="react-dom.js"></script><script type="module">
import Dialog from './OrderMemoDialog.js';import {createDraftJournal} from './lib/draftJournal.js';
const journal=createDraftJournal({name:'memo-ui-browser-check'});const owner='synthetic-staff';
let cloud=sessionStorage.getItem('memo-ui-cloud')||'Original memo';const receipts=new Map();
function App(){const [command,setCommand]=React.useState(null),[status,setStatus]=React.useState('Ready'),[offline,setOffline]=React.useState(false),[shownCloud,setShownCloud]=React.useState(cloud),[host,setHost]=React.useState(null);
 React.useEffect(()=>{journal.list(owner).then(rows=>{if(rows.length){const d=rows[0];setCommand({...d.payload,_draftRecovery:{key:d.key,owner:d.owner,revision:d.revision}});setStatus('Recovered memo after reload');}});},[]);
 const save=async c=>{await new Promise(r=>setTimeout(r,400));if(offline)throw new Error('Synthetic network unavailable');if(receipts.has(c.requestId))return {...receipts.get(c.requestId),current_memo:cloud};if(c.expectedMemo!==cloud)return {saved:false,conflict:true,current_memo:cloud,current_version:2};cloud=c.memo;sessionStorage.setItem('memo-ui-cloud',cloud);setShownCloud(cloud);const r={saved:true,current_memo:cloud,current_version:3};receipts.set(c.requestId,r);return r;};
 return React.createElement(React.Fragment,null,
 React.createElement('p',{id:'status'},status+' · Cloud: '+shownCloud+' · '+(offline?'Offline':'Online')),
 React.createElement('button',{onClick:()=>setCommand({id:'SO-SYNTHETIC',ownerId:owner,memo:cloud,expectedMemo:cloud})},'Open memo editor'),
 React.createElement('button',{onClick:()=>{cloud='Another editor changed this';sessionStorage.setItem('memo-ui-cloud',cloud);setShownCloud(cloud);}},'Simulate another editor'),
 React.createElement('button',{onClick:()=>setOffline(v=>!v)},'Toggle network'),
 React.createElement('label',null,'Memo'),React.createElement('div',{ref:setHost}),
 command&&React.createElement(Dialog,{inlineTarget:host,key:command.requestId||'new',initial:command,owner,journal,saveCommand:save,onClose:()=>{setStatus('Dialog closed; recovery kept unless acknowledged');setCommand(null);},onSaved:(id,memo)=>setStatus('Confirmed: '+memo)}));}
ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(App));
</script>`);
console.log(out);
