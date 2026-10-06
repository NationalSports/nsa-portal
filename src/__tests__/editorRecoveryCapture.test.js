import fs from 'fs';
import path from 'path';

// Exercise the actual capture callback from both shipped editors, including the
// synchronous buffered-size boundary and text fields that commit on blur.
describe.each(['OrderEditor.js','OrderEditorClassic.js'])('%s recovery capture',file=>{
  const source=fs.readFileSync(path.join(__dirname,'..',file),'utf8');
  const body=source.match(/const recoveryPaused=useRecoveryHandoff[\s\S]*?capture:\(\)=>\{([\s\S]*?)\n    \},/)[1];
  const capture=(flush,order,memo,po)=>Function('_flushActiveSizingDraft','oRef','memoInputRef','poInputRef','return ()=>{'+body+'}')(flush,order,memo,po);
  test('flushes the latest size then reads the live order and unblurred text',()=>{
    const ref={current:{id:'EST-2796',items:[{sizes:{M:2}}],memo:'old'}};
    const flush=()=>{ref.current={...ref.current,items:[{sizes:{M:9}}]};return true;};
    expect(capture(flush,ref,{current:{value:'latest memo'}},{current:{value:'PO 7'}})()).toEqual({id:'EST-2796',items:[{sizes:{M:9}}],memo:'latest memo',po_number:'PO 7'});
  });
  test('refuses a snapshot if the buffered field cannot be committed',()=>{
    expect(capture(()=>false,{current:{id:'EST-2796'}},{current:null},{current:null})()).toBeNull();
  });
});
