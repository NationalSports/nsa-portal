const escapeHtml=value=>String(value??'')
  .replace(/&/g,'&amp;')
  .replace(/</g,'&lt;')
  .replace(/>/g,'&gt;')
  .replace(/"/g,'&quot;')
  .replace(/'/g,'&#39;');

const money=value=>Number(value||0).toLocaleString('en-US',{
  style:'currency',currency:'USD',minimumFractionDigits:2,maximumFractionDigits:2,
});

export const bulkInvoiceEmailSubject=({customerName,totalDue})=>
  `Open Invoices — ${customerName||'Customer'} — ${money(totalDue)} due`;

export const buildBulkInvoiceEmailHtml=({message,customerName,totalDue,invoices=[],portalUrl=''})=>{
  const rows=invoices.map(inv=>{
    const balance=Number(inv.total||0)-Number(inv.paid||0);
    return '<tr>'
      +'<td style="padding:7px 9px;border-bottom:1px solid #e2e8f0;font-weight:700;color:#1e40af">'+escapeHtml(inv.id||'')+'</td>'
      +'<td style="padding:7px 9px;border-bottom:1px solid #e2e8f0">'+escapeHtml(inv.memo||'Invoice')+'</td>'
      +'<td style="padding:7px 9px;border-bottom:1px solid #e2e8f0">'+escapeHtml(inv.date||'—')+'</td>'
      +'<td style="padding:7px 9px;border-bottom:1px solid #e2e8f0;text-align:right;font-weight:700;color:#b91c1c">'+money(balance)+'</td>'
      +'</tr>';
  }).join('');
  const portalButton=portalUrl
    ?'<div style="margin:18px 0"><a href="'+escapeHtml(portalUrl)+'" style="display:inline-block;padding:11px 22px;background:#2563eb;color:#fff;text-decoration:none;border-radius:6px;font-weight:700">View Invoices in Portal</a></div>'
    :'';
  return '<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#1e293b">'
    +'<div style="white-space:pre-wrap;margin-bottom:16px">'+escapeHtml(message||'')+'</div>'
    +'<div style="padding:12px 14px;background:#f8fafc;border-radius:8px;margin-bottom:12px">'
    +'<div style="font-size:16px;font-weight:700">'+escapeHtml(customerName||'Customer')+'</div>'
    +'<div style="font-size:13px;color:#b91c1c;font-weight:700">Total due: '+money(totalDue)+'</div></div>'
    +'<table style="width:100%;border-collapse:collapse;font-size:12px"><thead><tr style="background:#f1f5f9">'
    +'<th style="padding:7px 9px;text-align:left">Invoice</th><th style="padding:7px 9px;text-align:left">Description</th>'
    +'<th style="padding:7px 9px;text-align:left">Date</th><th style="padding:7px 9px;text-align:right">Balance</th>'
    +'</tr></thead><tbody>'+rows+'</tbody></table>'+portalButton+'</div>';
};

export const applyBulkInvoiceSendHistory=(invoices,invoiceIds,{sentAt,sentBy,to,messageId})=>{
  const ids=new Set(invoiceIds||[]);
  const history={sent_at:sentAt,sent_by:sentBy,type:'open_invoice_batch',methods:['email'],to,messageId:messageId||null};
  const localSentAt=new Date(sentAt).toLocaleString();
  return (invoices||[]).map(inv=>ids.has(inv.id)?{
    ...inv,
    email_status:'sent',
    email_sent_at:localSentAt,
    sent_history:[...(inv.sent_history||[]),history],
  }:inv);
};

export const buildBulkInvoiceMessages=({invoices=[],recipientEmails=[],message='',currentUser={},sentAt})=>{
  const to=recipientEmails.join(', ');
  return invoices.filter(inv=>inv.so_id).map((inv,index)=>({
    id:`m${new Date(sentAt).getTime()}-${index}`,
    so_id:inv.so_id,
    author_id:currentUser.id,
    text:`[Invoice ${inv.id}] Sent in open-invoice batch to ${to}\n\n${message}`,
    ts:new Date(sentAt).toLocaleString(),
    read_by:currentUser.id?[currentUser.id]:[],
    dept:'sales',
    tagged_members:[],
    entity_type:'so',
    entity_id:inv.so_id,
  }));
};

