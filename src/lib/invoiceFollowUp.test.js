import { invoiceFollowUpBaseMs, invoiceFollowUpDate } from './invoiceFollowUp';

describe('invoice follow-up never lands before the invoice date', () => {
  const sent = new Date(2026, 8, 21, 8, 11).getTime(); // 9/21/2026 8:11am
  it('counts from the invoice date when the invoice is future-dated', () => {
    expect(invoiceFollowUpBaseMs({ date: '2026-10-06' }, sent)).toBe(new Date(2026, 9, 6, 9, 0).getTime());
  });
  it('counts from the send time when the invoice date is already past', () => {
    expect(invoiceFollowUpBaseMs({ date: '2026-09-01' }, sent)).toBe(sent);
    expect(invoiceFollowUpBaseMs({}, sent)).toBe(sent);
  });
  it('pushes an already-saved early follow-up out to the invoice date', () => {
    const fu = invoiceFollowUpDate({ date: '2026-10-06', follow_up_at: new Date(2026, 8, 28).toISOString() });
    expect(fu.getTime()).toBe(new Date(2026, 9, 6, 9, 0).getTime());
  });
  it('leaves a follow-up after the invoice date alone', () => {
    const iso = new Date(2026, 9, 13).toISOString();
    expect(invoiceFollowUpDate({ date: '2026-10-06', follow_up_at: iso }).toISOString()).toBe(iso);
  });
});
