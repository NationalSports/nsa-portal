const fs = require('fs');
const path = require('path');

// The size grid intentionally buffers text until blur. A Save click fires immediately after
// that blur, so both live editors must commit the draft synchronously and save from the mirrored
// order ref. Otherwise the click can persist the previous quantity (usually zero).
describe.each(['OrderEditor.js', 'OrderEditorClassic.js'])('%s quantity draft save boundary', file => {
  const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

  test('commits the focused size draft synchronously before Save reads the order', () => {
    expect(source).toContain("import { createPortal, flushSync } from 'react-dom';");
    expect(source).toContain("import QuantityDraftInput from './QuantityDraftInput';");
    expect(fs.readFileSync(path.join(__dirname,'..','QuantityDraftInput.js'),'utf8')).toContain('data-sizing-draft="true"');
    expect(source).toContain(file==='OrderEditor.js'
      ?'flushSync(()=>{uSz(idx,sz,v);_dropSizingDraft(_draftKey)})'
      :'flushSync(()=>{uSz(idx,sz,v);_dropSizingDraft(k)})');
    expect(source).not.toContain('React.startTransition(()=>{uSz(idx,sz,v)');
    expect(source).toContain('if(!_flushActiveSizingDraft())');
    expect(source).toContain('const current=oRef.current||o;');
  });

  test('does not let autosave persist the old quantity over an active draft', () => {
    expect(source).toContain('const sizingDraftRef=useRef({});');
    expect(source).toContain('dirtyRef2.current=true;setDirty(true)');
    expect(source).toContain('if(Object.keys(sizingDraftRef.current).length){');
    expect(source).toContain('if(!emergency)return;');
  });

  test('mirrors the committed size into the ref consumed by the same-tick Save click', () => {
    expect(source).toContain('oRef.current=next;return next');
    expect(source).toContain('const item=safeItems(oRef.current||o)[i]');
  });
});
