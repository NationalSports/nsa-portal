import {
  markTopstarEmailFailed,
  markTopstarEmailSent,
  topstarAttachmentName,
  topstarPoMatches,
} from '../lib/topstarEmail';

describe('Topstar email state', () => {
  test('does not call a PO waiting until Brevo accepts it', () => {
    const failed = markTopstarEmailFailed({ id: 'ts-1', po_id: 'TS 1', status: 'sending' }, 'invalid attachment', '2026-09-08T12:00:00.000Z');
    expect(failed).toMatchObject({ status: 'email_failed', topstar_send_error: 'invalid attachment', topstar_send_failed_at: '2026-09-08T12:00:00.000Z' });

    const sent = markTopstarEmailSent(failed, { messageId: '<brevo-123>' }, '2026-09-08T12:01:00.000Z');
    expect(sent).toMatchObject({ status: 'waiting', topstar_message_id: '<brevo-123>', topstar_sent_at: '2026-09-08T12:01:00.000Z', topstar_send_error: null });
  });

  test('matches a PO by stable id, falling back to its PO number', () => {
    expect(topstarPoMatches({ id: 'a', po_id: 'TS 1' }, { id: 'a', po_id: 'TS old' })).toBe(true);
    expect(topstarPoMatches({ po_id: 'TS 2' }, { po_id: 'TS 2' })).toBe(true);
  });

  test('labels PDF-compatible Illustrator uploads as PDF for Brevo', () => {
    expect(topstarAttachmentName('https://res.cloudinary.com/example/logo.ai', 'embroidery', 0)).toBe('embroidery-1.pdf');
    expect(topstarAttachmentName('https://res.cloudinary.com/example/logo.png?x=1', 'vector', 1)).toBe('vector-2.png');
  });
});
