import fs from 'fs';
import path from 'path';
import {canAcknowledgeSave} from '../lib/saveAcknowledgement';

// Execute the actual editor callbacks with deferred I/O so the interleaving is
// deterministic, without mounting the unrelated catalog and production screens.
describe.each(['OrderEditor.js','OrderEditorClassic.js'])('%s save races',file=>{
  const source=fs.readFileSync(path.join(__dirname,'..',file),'utf8');
  test('typing a quantity during a pending save prevents its acknowledgement',()=>{
    const orderEditRevision={current:4},sizingDraftRef={current:{}},dirtyRef2={current:false};
    const setDirty=jest.fn();
    const callback=source.match(/const _stageSizingDraft=(.*);\n/)[1];
    const stage=Function('orderEditRevision','sizingDraftRef','dirtyRef2','setDirty','return '+callback)(orderEditRevision,sizingDraftRef,dirtyRef2,setDirty);
    stage('0_M','1');
    expect(canAcknowledgeSave(true,4,orderEditRevision.current,1,1)).toBe(false);
    const revision=orderEditRevision.current;
    stage('0_M','13');
    expect(orderEditRevision.current).toBeGreaterThan(revision);
    expect(sizingDraftRef.current['0_M']).toBe('13');
    expect(setDirty).toHaveBeenCalledTimes(1); // subsequent digits stay inexpensive
  });

  const sections=[...source.matchAll(/if\(_shipPrefRequired\(\)\)\{[^\n]+\}\n([\s\S]*?)await saveSONow\(([^\n]+?)\)\}\}/g)];
  test('all manual Save buttons are covered',()=>expect(sections).toHaveLength(file==='OrderEditorClassic.js'?2:1));
  test.each(sections.map((match,index)=>[index,match[1]+'await saveSONow('+match[2]+');']))('Save button %s preserves edits made during preparation',async(index,body)=>{
    let finish;
    const orderEditRevision={current:1},editorSaveSeq={current:0};
    const current={memo:'old'},saveO=current,o=current;
    const reconcilePromoDraw=()=>new Promise(resolve=>{finish=resolve});
    const saveSONow=jest.fn(),setO=jest.fn(),nf=jest.fn();
    const run=Function('orderEditRevision','editorSaveSeq','current','saveO','o','reconcilePromoDraw','promoTotals','saveSONow','setO','nf','isE','return async()=>{'+body+'}')(orderEditRevision,editorSaveSeq,current,saveO,o,reconcilePromoDraw,{},saveSONow,setO,nf,true);
    const pending=run();
    orderEditRevision.current++; // newer memo, item edit, or staged quantity
    finish({ok:true,order:current});
    await pending;
    expect(setO).not.toHaveBeenCalled();
    expect(saveSONow).not.toHaveBeenCalled();
    expect(nf).toHaveBeenCalled();
    const unchanged=run();finish({ok:true,order:current});await unchanged;
    expect(saveSONow).toHaveBeenCalledWith(current,'Estimate');
  });
});
