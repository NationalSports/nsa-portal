// Dollar Reports show CHARGED and REFUNDED amounts. Store the net, not the first
// number beside a label. PDF extraction can put the label and each amount on
// separate lines (including the two-line "Online Processing / Fee" label).
const moneyTokens = text => [...text.matchAll(/\(?\s*-?\s*\$\s*[\d,]+\.\d{2}\s*\)?|\(?-?[\d,]+\.\d{2}\)?/g)].map(m => {
  const token=m[0].trim();
  return {value:Number(token.replace(/[^\d.]/g,''))*(token.includes('(')||token.includes('-')?-1:1),negative:token.includes('(')||token.includes('-')};
});
const cents = value => Math.round(value*100)/100;
export function parseOmgDollar(text) {
  const source=String(text||'');
  const labels=[...source.matchAll(/\b(?:Online\s+)?Processing(?:\s+Fee)?\b|\bSales\s+Tax\b|\bShipping(?:\s+Fee)?\b|\bFundrais(?:ing|e)(?:\s+Total)?\b|\bGrand\s+Total\b/gi)];
  const out={shipping:0,processing:0,tax:0,fundraise:0,grand:0};
  for(let i=0;i<labels.length;i++) {
    const label=labels[i];
    const key=/processing/i.test(label[0])?'processing':/sales/i.test(label[0])?'tax':/shipping/i.test(label[0])?'shipping':/fundrais/i.test(label[0])?'fundraise':'grand';
    const block=source.slice(label.index+label[0].length,labels[i+1]?.index??source.length).split(/\bTotal\b|\bPrivacy\b/i)[0];
    const amounts=moneyTokens(block);
    if(!amounts.length)continue;
    if(amounts.length>3)throw new Error('Ambiguous OMG '+key+' amounts. Review the Dollar Report.');
    // Three columns are Charged / Refunded / Net. Validate rather than add net twice.
    if(amounts.length===3){
      const expected=cents(amounts[0].value-Math.abs(amounts[1].value));
      if(Math.abs(expected-amounts[2].value)>0.005)throw new Error('OMG '+key+' charged/refunded/net amounts do not reconcile.');
      out[key]=amounts[2].value;
    }else{
      if(amounts.length===2&&!amounts[1].negative)throw new Error('Ambiguous OMG '+key+' refund amount. Review the Dollar Report.');
      out[key]=cents(amounts.reduce((sum,a)=>sum+a.value,0));
    }
  }
  return out;
}
