const normalize = value => String(value || '').trim().toLowerCase();
const generic = new Set(['gmail.com','yahoo.com','outlook.com','hotmail.com','icloud.com','aol.com']);
function exclusionReason(parsed, staffEmails = [], vendorEmails = []) {
  const email = normalize(parsed.sender_email);
  if (/@nationalsportsapparel\.com$/.test(email) || email === 'nsashipping1@gmail.com' || staffEmails.some(e => normalize(e) === email)) return 'Internal team email';
  const domain = email.split('@')[1];
  if (vendorEmails.some(e => normalize(e) === email || (domain && !generic.has(domain) && normalize(e).split('@')[1] === domain))) return 'Supplier email';
  if (/^(quickbooks@notification\.intuit\.com|noreply@lakeshoregroup\.com)$/.test(email)) return 'Automated vendor notification';
  return null;
}
module.exports = { exclusionReason };
