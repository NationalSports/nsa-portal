import fs from 'fs';
import path from 'path';
import {
  applyBulkInvoiceSendHistory,
  buildBulkInvoiceEmailHtml,
  buildBulkInvoiceMessages,
  bulkInvoiceEmailSubject,
} from '../lib/bulkInvoiceEmail';

describe('bulk open-invoice email',()=>{
  test('builds a useful subject and escapes customer-controlled HTML',()=>{
    expect(bulkInvoiceEmailSubject({customerName:'Fresno Pacific',totalDue:1234.5}))
      .toBe('Open Invoices — Fresno Pacific — $1,234.50 due');
    const html=buildBulkInvoiceEmailHtml({
      message:'Hi <script>alert(1)</script>',
      customerName:'A & B',
      totalDue:1234.5,
      portalUrl:'https://example.com/?a=1&b=2',
      invoices:[{id:'INV-1',memo:'Jerseys <rush>',date:'2026-08-23',total:1500,paid:265.5}],
    });
    expect(html).toContain('Hi &lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('A &amp; B');
    expect(html).toContain('Jerseys &lt;rush&gt;');
    expect(html).toContain('$1,234.50');
    expect(html).toContain('a=1&amp;b=2');
    expect(html).not.toContain('<script>');
  });

  test('records history only on invoices that were actually sent',()=>{
    const original=[
      {id:'INV-1',sent_history:[{type:'prior'}]},
      {id:'INV-2'},
    ];
    const result=applyBulkInvoiceSendHistory(original,['INV-1'],{
      sentAt:'2026-08-24T01:02:03.000Z',sentBy:'Steve',to:'steve@example.com',messageId:'brevo-123',
    });
    expect(result[0].email_status).toBe('sent');
    expect(result[0].sent_history).toEqual([
      {type:'prior'},
      expect.objectContaining({type:'open_invoice_batch',to:'steve@example.com',messageId:'brevo-123'}),
    ]);
    expect(result[1]).toBe(original[1]);
  });

  test('creates an SO activity note for every attached invoice with an SO',()=>{
    const result=buildBulkInvoiceMessages({
      invoices:[{id:'INV-1',so_id:'SO-1'},{id:'INV-2'},{id:'INV-3',so_id:'SO-3'}],
      recipientEmails:['billing@example.com'],
      message:'Please see attached.',
      currentUser:{id:'u1',name:'Steve'},
      sentAt:'2026-08-24T01:02:03.000Z',
    });
    expect(result).toHaveLength(2);
    expect(result.map(message=>message.so_id)).toEqual(['SO-1','SO-3']);
    expect(result[0]).toEqual(expect.objectContaining({
      author_id:'u1',entity_type:'so',entity_id:'SO-1',read_by:['u1'],
    }));
    expect(result[0].text).toContain('billing@example.com');
  });

  test('the customer modal uses the real mail and PDF paths, not the old demo alert',()=>{
    const source=fs.readFileSync(path.join(__dirname,'..','CustDetail.js'),'utf8');
    expect(source).toContain('await sendBrevoEmail');
    expect(source).toContain('await buildPdfAttachment');
    expect(source).toContain('sendOpenInvoiceBatch(displayInvs)');
    expect(source).not.toContain('invoice(s) (demo)');
  });
});
