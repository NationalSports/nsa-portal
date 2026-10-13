// Steve's approved pilot signature, recreated from his supplied signature image.
// Prefer the user's actual Gmail HTML whenever Gmail returns one.
function signatureFor(email, gmailSignature) {
  if (gmailSignature && gmailSignature.trim()) return gmailSignature;
  if (String(email).toLowerCase() !== 'steve@nationalsportsapparel.com') return '';
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="font-family:Arial,Helvetica,sans-serif;border-collapse:collapse;background:#fff"><tr>
<td style="padding:0 24px 0 0;vertical-align:middle;border-right:1px solid #192b59"><img src="https://connect.nationalsportsapparel.com/NEW%20NSA%20Logo%20on%20white.png" alt="National Sports Apparel" width="190" style="display:block;width:190px;height:auto;border:0"></td>
<td style="padding:0 0 0 24px;vertical-align:top"><div style="font-size:18px;line-height:24px;font-weight:bold;color:#192b59">Steve Peterson</div><div style="font-size:13px;line-height:19px;font-weight:bold;color:#192b59">National Sports Apparel</div><div style="font-size:12px;line-height:18px;font-style:italic;color:#666">California's Largest Independent Team Dealer</div>
<table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:8px;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:18px;color:#222"><tr><td style="color:#ab2932;font-weight:bold;padding-right:10px">P</td><td><a href="tel:+17147918973" style="color:#222;text-decoration:none">714.791.8973</a></td></tr><tr><td style="color:#ab2932;font-weight:bold;padding-right:10px">A</td><td>2238 N Glassell St Ste E, Orange, CA 92865</td></tr><tr><td style="color:#ab2932;font-weight:bold;padding-right:10px">W</td><td><a href="https://nationalsportsapparel.com" style="color:#192b59;font-weight:bold;text-decoration:none">nationalsportsapparel.com</a></td></tr></table></td></tr></table>`;
}
module.exports = { signatureFor };
