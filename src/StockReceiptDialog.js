import React from 'react';

export default function StockReceiptDialog({labels, onPrint, onClose}) {
  if (!labels.length) return null;
  return <div role="dialog" aria-modal="true" aria-label="Stock check-in labels" style={{position:'fixed',inset:0,zIndex:3300,background:'rgba(15,23,42,.6)',display:'flex',alignItems:'center',justifyContent:'center',padding:16}}>
    <div style={{background:'white',borderRadius:12,padding:20,width:'100%',maxWidth:520,maxHeight:'85vh',overflowY:'auto'}}>
      <h2 style={{marginTop:0}}>NSA STOCK — Checked In</h2>
      {labels.map((label, i) => <div key={i} style={{borderTop:'1px solid #ddd',padding:'10px 0'}}>
        <strong>{label.code}</strong>
        {label.items.map((item, j) => <div key={j} style={{marginTop:8}}>{item.title}<br/>{item.detail}<br/><strong>{item.sizes}</strong></div>)}
      </div>)}
      <p>Print or reprint these labels without receiving the units again.</p>
      <button onClick={onPrint} style={{padding:12,marginRight:12}}>Print {labels.length > 1 ? 'Labels' : 'Label'}</button>
      <button onClick={onClose} style={{padding:12}}>Done</button>
    </div>
  </div>;
}
