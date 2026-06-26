// Branded HTML email shell for onboarding emails (invite + HR notification).
// Mirrors the nationalsportsapparel.com chrome: white header with the logo, a
// red accent stripe, a navy heading band, and a navy footer. Table-based +
// inline styles so it renders consistently across email clients (incl. Outlook).
const BRAND = {
  navy: '#192853', navyDark: '#0F1A38', red: '#962C32', ink: '#2A2F3E', muted: '#5A6075', bg: '#EEF1F6',
};
const logoUrl = () => process.env.NSA_LOGO_URL || 'https://www.nationalsportsapparel.com/images/nsa-logo.png';

// opts: { heading, bodyHtml, ctaText, ctaUrl, note, preheader }
function brandedEmail(opts) {
  const o = opts || {};
  const cta = o.ctaText && o.ctaUrl
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:22px 0 4px;">
         <tr><td align="center" bgcolor="${BRAND.red}" style="background:${BRAND.red};border-radius:4px;">
           <a href="${o.ctaUrl}" style="display:inline-block;padding:14px 32px;color:#ffffff;font-weight:bold;font-size:15px;letter-spacing:.8px;text-transform:uppercase;text-decoration:none;font-family:Arial,Helvetica,sans-serif;">${o.ctaText}</a>
         </td></tr>
       </table>`
    : '';
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:${BRAND.bg};">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${o.preheader || ''}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.bg};padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:10px;overflow:hidden;box-shadow:0 2px 10px rgba(15,26,56,.10);font-family:Arial,Helvetica,sans-serif;">
        <tr><td align="center" style="padding:26px 24px 18px;background:#ffffff;">
          <img src="${logoUrl()}" alt="National Sports Apparel" width="200" style="display:block;width:200px;max-width:64%;height:auto;">
        </td></tr>
        <tr><td style="height:5px;line-height:5px;font-size:0;background:${BRAND.red};">&nbsp;</td></tr>
        <tr><td style="background:${BRAND.navy};padding:16px 28px;">
          <div style="font-weight:bold;font-size:20px;letter-spacing:.5px;text-transform:uppercase;color:#ffffff;">${o.heading || ''}</div>
        </td></tr>
        <tr><td style="padding:24px 28px;color:${BRAND.ink};font-size:15px;line-height:1.6;">
          ${o.bodyHtml || ''}
          ${cta}
          ${o.note ? `<div style="font-size:12.5px;color:${BRAND.muted};line-height:1.6;margin-top:16px;">${o.note}</div>` : ''}
        </td></tr>
        <tr><td style="background:${BRAND.navyDark};padding:22px 28px;color:rgba(255,255,255,.72);font-size:12px;line-height:1.65;">
          <div style="font-weight:bold;font-size:16px;letter-spacing:1px;text-transform:uppercase;color:#ffffff;">National Sports Apparel</div>
          <div style="margin-top:5px;">California's Largest Independent Team Dealer</div>
          <div style="margin-top:8px;">
            <a href="tel:+17142798777" style="color:#ffffff;text-decoration:none;">(714) 279-8777</a>
            &nbsp;&middot;&nbsp;
            <a href="mailto:hello@nationalsportsapparel.com" style="color:#ffffff;text-decoration:none;">hello@nationalsportsapparel.com</a>
          </div>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

module.exports = { brandedEmail, logoUrl, BRAND };
