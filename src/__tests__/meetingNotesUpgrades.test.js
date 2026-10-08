// CRA jsdom lacks structuredClone; Blob is immutable, preserve it in this test clone.
global.structuredClone = function clone(v) { if(v instanceof Blob)return v;if(Array.isArray(v))return v.map(clone);if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).map(([k,x])=>[k,clone(x)]));return v; };
import 'fake-indexeddb/auto';
import {recoveryPut,recoveryList,recoveryClear,RECOVERY_TTL_MS,RECOVERY_MAX_BYTES} from '../meetingRecovery';
import {createChunkUploader} from '../meetingRecorder';
const {splitTranscript,extractDraft}=require('../../netlify/functions/_meetingAi');
const {evidenceFor,validateAnswer}=require('../../netlify/functions/meeting-ask');
const {annotations}=require('../../netlify/functions/_meetingAttachments');
const folder='rep/test-note';
beforeEach(async()=>{for(const r of await recoveryList())await recoveryClear(r.folder)});
test('new uploader recovers persisted audio after the old page is gone, then removes it',async()=>{
  await recoveryPut(folder,new Blob(['saved voice']),{segment:0,index:0,ext:'webm',mime:'audio/webm'});
  await recoveryPut('another-rep/note',new Blob(['private']),{segment:0,index:0,ext:'webm',mime:'audio/webm'});
  const upload=jest.fn(async()=>({error:null}));
  const u=createChunkUploader({supabase:{storage:{from:()=>({upload})}},folder});await u.recover();await u.flush();
  expect(upload).toHaveBeenCalledTimes(1);expect(upload.mock.calls[0][0]).toBe(folder+'/s0-c0000.webm');
  expect(await recoveryList(folder)).toHaveLength(0);expect(await recoveryList('another-rep/note')).toHaveLength(1);
});
test('expiration and device byte cap prevent an unbounded local archive',async()=>{
  const date=jest.spyOn(Date,'now');date.mockReturnValue(1000);
  await recoveryPut(folder,new Blob(['old']),{segment:0,index:0});date.mockReturnValue(1000+RECOVERY_TTL_MS);
  expect(await recoveryList(folder)).toEqual([]);date.mockRestore();
  await expect(recoveryPut(folder,{size:RECOVERY_MAX_BYTES+1},{segment:0,index:1})).rejects.toThrow();
});
test('refused upload stays recoverable and flush fails instead of silently finishing',async()=>{
  const u=createChunkUploader({folder,supabase:{storage:{from:()=>({upload:async()=>({error:{statusCode:403}})})}}});
  u.add(new Blob(['audio']),{segment:0,index:0,ext:'webm',mime:'audio/webm'});
  await expect(u.flush()).rejects.toThrow('refused');expect(await recoveryList(folder)).toHaveLength(1);
});
test('long sources cover the ending and resume completed extraction parts without billing twice',async()=>{
  const text='A'.repeat(30001)+'\nFinal promise: send the quote Friday.';
  expect(splitTranscript(text).join('')).toBe(text);
  const cache={0:{draft:{headline:'First',summary:'Beginning',sections:{products_discussed:[],decisions:[],concerns:[]},action_items:[],people_mentioned:[],line_items:[],opportunities:[],competitors:[],sports:[]},usage:{input_tokens:1,output_tokens:1},model:'test'}};
  const original=global.fetch;const onPart=jest.fn();global.fetch=jest.fn(async()=>({ok:true,json:async()=>({content:[{type:'text',text:JSON.stringify({headline:'End',summary:'Final promise',action_items:[{text:'Send quote Friday'}]})}],usage:{input_tokens:2,output_tokens:2}})}));
  try{const r=await extractDraft({apiKey:'x',transcript:text,cachedParts:cache,onPart});expect(global.fetch).toHaveBeenCalledTimes(1);expect(r.draft.coverage.complete).toBe(true);expect(r.draft.action_items[0].text).toBe('Send quote Friday');expect(onPart).toHaveBeenCalledWith(1,expect.any(Object));}finally{global.fetch=original}
});
test('Q&A citations must quote exact source evidence, and inaccessible transcripts are not supplied',()=>{
  const notes=[{id:'n1',title:'Budget',final:{summary:'Coach budget $2000'},created_at:'2026-10-08'}];
  const e=evidenceFor(notes,[],'What budget?');expect(e[0].source).toBe('approved note');
  expect(validateAnswer({answer:'$9000',citations:[{id:'E1',quote:'budget $9000'}]},e).citations).toEqual([]);
  expect(validateAnswer({answer:'$2000',citations:[{id:'E1',quote:'Coach budget $2000'}]},e).citations[0].note_id).toBe('n1');
});
test('annotations are bounded and preserve highlights and timing',()=>{
  expect(annotations([{kind:'highlight',text:'Budget confirmed',at_ms:-5},{text:''}])).toEqual([{kind:'highlight',text:'Budget confirmed',at_ms:0}]);
  expect(annotations(Array.from({length:150},()=>({text:'a'})))).toHaveLength(100);
});
