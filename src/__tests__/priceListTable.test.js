import {priceListTable} from '../lib/priceListTable';
const content='Sheet: Sheet1\nColumn labels:\nRow 1:  | Item |  | Description | Price\nSource rows:\nRow 604:  | KAL |  | ADULT KNEE PAD | 8.37\nRow 605:  | KAS |  | LIGHTWEIGHT KNEE PAD | 2.15';
test('shows matching product with original price and labels, retaining column alignment',()=>{
 const table=priceListTable(content,'kas');
 expect(table.columns.map(c=>c.label)).toEqual(['Item','Description','Price']);
 expect(table.rows.map(r=>r.number)).toEqual(['605']);
 expect(table.rows[0].cells[4]).toBe('2.15');expect(table.hidden).toBe(1);
});
test('multi-word matching keeps rows together and falls back to context when terms span rows',()=>{
 expect(priceListTable(content,'lightweight knee').rows).toHaveLength(1);
 expect(priceListTable(content,'KAL KAS').rows).toHaveLength(2);
});
test('ambiguous layouts and PDFs use original text instead of guessing prices',()=>{
 expect(priceListTable('PDF page: item KAS 2.15')).toBeNull();
 expect(priceListTable(content+'\nRow 606: | broken | columns')).toBeNull();
});
test('preserves zero, currency and additional price columns',()=>{
 const t=priceListTable('Column labels:\nRow 1: Item | Cost | Retail\nSource rows:\nRow 1: Item | Cost | Retail\nRow 2: KAS | 0.00 | EUR 2.15','KAS');
 expect(t.rows).toHaveLength(1);expect(t.rows[0].cells).toEqual(['KAS','0.00','EUR 2.15']);
});
