// Presentation only: retain source labels/values; never infer currency or a cost column.
export function priceListTable(content, query='') {
  const header=String(content||'').match(/Column labels:\nRow (\d+): ([^\n]+)\nSource rows:\n/);
  if(!header)return null;
  const labels=header[2].split('|').map(s=>s.trim());
  const source=content.slice(header.index+header[0].length);
  const lines=source.split('\n').filter(s=>s.trim());
  const rows=[];
  for(const line of lines){
    const match=line.match(/^Row (\d+): (.*)$/);
    if(!match)return null;
    const cells=match[2].split('|').map(s=>s.trim());
    if(cells.length!==labels.length)return null;
    if(match[1]!==header[1])rows.push({number:match[1],cells});
  }
  if(!rows.length)return null;
  const columns=labels.map((label,index)=>({label:label||`Column ${index+1}`,index})).filter(c=>labels[c.index]||rows.some(r=>r.cells[c.index]));
  if(!columns.length)return null;
  const terms=query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  const matched=terms.length?rows.filter(r=>terms.every(t=>r.cells.join(' ').toLowerCase().includes(t))):[];
  return {columns,rows:matched.length?matched:rows,matched:matched.length>0,hidden:matched.length?rows.length-matched.length:0};
}
