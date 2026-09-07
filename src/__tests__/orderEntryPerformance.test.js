import React,{useRef,useState} from 'react';
import {render,screen,fireEvent} from '@testing-library/react';
import {flushSync} from 'react-dom';
import QuantityDraftInput from '../QuantityDraftInput';
import {filterOrderCatalog,useOrderCatalogResults} from '../lib/orderCatalogSearch';

test('quantity keystrokes do not rerender the order, and blur-before-save commits the latest draft',()=>{
  let renders=0;const saved=jest.fn();
  function Order(){
    renders++;const [qty,setQty]=useState(8),[dirty,setDirty]=useState(false);
    const drafts=useRef({}),current=useRef(qty);
    return <><QuantityDraftInput value={qty} draftKey="0_M"
      onStage={(k,v)=>{const first=!(k in drafts.current);drafts.current[k]=v;if(first)setDirty(true);}}
      onCommit={raw=>flushSync(()=>{current.current=parseInt(raw,10)||0;setQty(current.current);delete drafts.current['0_M'];})}/>
      <button onClick={()=>saved(current.current)}>{dirty?'Save':'Saved'}</button></>;
  }
  render(<Order/>);const input=screen.getByRole('textbox');fireEvent.focus(input);
  fireEvent.change(input,{target:{value:''}});const afterFirst=renders;
  fireEvent.change(input,{target:{value:'1'}});fireEvent.change(input,{target:{value:'13'}});
  expect(renders).toBe(afterFirst);
  fireEvent.blur(input);fireEvent.click(screen.getByText('Save'));
  expect(saved).toHaveBeenCalledWith(13);
});

test('quantity rejected by a committed-quantity guard returns to the authoritative value',()=>{
  render(<QuantityDraftInput value={8} draftKey="0_M" onStage={()=>{}} onCommit={()=>{}}/>);
  const input=screen.getByRole('textbox');fireEvent.focus(input);
  fireEvent.change(input,{target:{value:'1'}});fireEvent.blur(input);
  expect(input.value).toBe('8');
});

test('catalog search preserves ordering, token matching, archive and Momentec exclusions',()=>{
  const rows=[{sku:'AB',name:'Shirt',brand:'Adidas',color:'Navy'},
    {sku:'AB2',name:'Shirt',brand:'Adidas',color:'Navy',is_archived:true},
    {sku:'AB3',name:'Shirt',brand:'Momentec',color:'Navy'},
    {sku:'CD',name:'Shirt',brand:'Adidas',color:'White'}];
  expect(filterOrderCatalog(rows,'ADIDAS navy')).toEqual([rows[0]]);
  expect(filterOrderCatalog(rows,'shirt')).toEqual([rows[0],rows[3]]);
  expect(filterOrderCatalog(rows,'   ')).toEqual([]);
  expect(filterOrderCatalog(rows,'a')).toEqual([]);
});

test('20,000-product catalog is untouched on empty searches and unrelated renders',()=>{
  let reads=0;
  const products=Array.from({length:20000},(_,i)=>({get sku(){reads++;return 'SKU'+i;},name:'Shirt',brand:'Adidas',color:'Navy'}));
  function Search({query,tick,rows=products}){const found=useOrderCatalogResults(rows,query);return <span>{tick}:{found.length}</span>;}
  const view=render(<Search query="" tick={0}/>);expect(reads).toBe(0);
  view.rerender(<Search query="shirt" tick={1}/>);expect(reads).toBe(20000);
  for(let i=2;i<12;i++)view.rerender(<Search query="shirt" tick={i}/>);
  expect(reads).toBe(20000);
  view.rerender(<Search query="shirt" tick={12} rows={[...products]}/>);expect(reads).toBe(40000);
});
