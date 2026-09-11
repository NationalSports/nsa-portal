import fs from 'fs';
import path from 'path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
const babel=require('@babel/core');
const src=fs.readFileSync(path.join(__dirname,'..','App.js'),'utf8');
const code=babel.transformSync(src.slice(src.indexOf('function LostArtJobsCard(){'),src.indexOf('function AuthSetupPage(')),{babelrc:false,configFile:false,presets:[require.resolve('@babel/preset-react')]}).code;
function render(name,states){
  let i=0;
  const hooks={...React,useState:()=>[states[i++],()=>{}],useEffect:()=>{},useCallback:f=>f};
  const component=Function('React','supabase',code+';return '+name)(hooks,null);
  return renderToStaticMarkup(component({sos:[],cust:[]}));
}
test.each([
 ['LostArtJobsCard',[7,null,'',false],'Not checked','No removals'],
 ['LostArtJobsCard',[7,[], '',true],'Loading','No removals'],
 ['LostArtJobsCard',[7,null,'Missing function',false],'Check unavailable','Shown:'],
 ['LostArtJobsCard',[7,[], '',false],'No removals','Check unavailable'],
 ['SystemHealthCard',[null,false,''],'Not checked','All checks passing'],
 ['SystemHealthCard',[{},true,''],'Loading','All checks passing'],
 ['SystemHealthCard',[null,false,'Permission denied'],'Check unavailable','Orphan Jobs'],
 ['SystemHealthCard',[{},false,''],'All checks passing','Check unavailable'],
 ['SystemHealthCard',[{orphan_count:1,orphan_system_loss_count:1},false,''],'unattributed deletion evidence','All checks passing'],
 ['SystemHealthCard',[{orphan_count:3},false,'Refresh failed'],'Check unavailable','Orphan Jobs'],
])('%s distinguishes unavailable checks from successful results', (name,states,expected,forbidden)=>{
  const html=render(name,states);
  expect(html).toContain(expected);expect(html).not.toContain(forbidden);
});
