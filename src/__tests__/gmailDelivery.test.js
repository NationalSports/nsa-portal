const { readReport } = require('../../netlify/functions/_gmailDelivery');
const b64 = (text) => Buffer.from(text).toString('base64url');
const report = (id = '<original@example.com>', action = 'failed', status = '5.7.1') => ({
  internalDate: '1789999999000',
  payload: { mimeType: 'multipart/report', parts: [
    { mimeType: 'message/delivery-status', body: { data: b64(`Original-Message-ID: ${id}\r\n\r\nFinal-Recipient: rfc822; coach@district.edu\r\nAction: ${action}\r\nStatus: ${status}\r\nDiagnostic-Code: smtp; 550 Sender blocked`) } },
  ] },
});
test('correlates a permanent Gmail bounce to the exact outgoing Message-ID', () => {
  expect(readReport(report(), '<original@example.com>')).toMatchObject({ status: 'failed', email: 'coach@district.edu', reason: '550 Sender blocked' });
});
test('unrelated bounces, temporary deferrals and ordinary quoted email are not failures', () => {
  expect(readReport(report('<other@example.com>'), '<original@example.com>')).toBeNull();
  expect(readReport(report(undefined, 'delayed', '4.2.0'), '<original@example.com>')).toBeNull();
  const ordinary = report(); ordinary.payload.mimeType = 'multipart/mixed'; ordinary.payload.parts[0].mimeType = 'text/plain';
  expect(readReport(ordinary, '<original@example.com>')).toBeNull();
});
