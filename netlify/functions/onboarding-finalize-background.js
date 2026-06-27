// Background finalize step. Fired (fire-and-forget) by onboarding-public when a
// hire submits their packet. Netlify treats any "*-background" function as async
// with a 15-minute budget, so the hire's submit returns instantly while this
// does the slow work: build the packet PDFs, email the ZIP to HR, and drop a
// copy into a per-hire folder in the shared "Employee Forms" Google Drive.
//
// Auth: validates the invite token AND requires the internal secret header
// (set by onboarding-public). Idempotent — re-running won't double-send unless
// { force:true } is passed.
//
// Env: ONBOARDING_HR_EMAIL (default steve@nationalsportsapparel.com),
//      BREVO_API_KEY, plus the GOOGLE_SA_* / EMPLOYEE_FORMS_FOLDER_ID set used
//      by _googleDrive.js (Drive copy is skipped if those are absent).
const { getSupabaseAdmin } = require('./_shared');
const { buildPacketFiles, zipFiles, safeName } = require('./_onboardingPacket');
const { brandedEmail } = require('./_onboardingEmail');
const drive = require('./_googleDrive');

const HR_EMAIL = () => process.env.ONBOARDING_HR_EMAIL || 'steve@nationalsportsapparel.com';

async function emailPacketToHr(invite, zipBuffer, filename, driveUrl) {
  const brevoKey = process.env.BREVO_API_KEY || process.env.REACT_APP_BREVO_API_KEY || '';
  if (!brevoKey) return { ok: false, error: 'BREVO_API_KEY not set' };
  const driveLine = driveUrl
    ? `<p style="font-size:13px;color:#334155">A copy was also filed in Google Drive: <a href="${driveUrl}">open folder</a>.</p>`
    : '';
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json', 'api-key': brevoKey },
    body: JSON.stringify({
      sender: { name: 'National Sports Apparel', email: 'noreply@nationalsportsapparel.com' },
      to: [{ email: HR_EMAIL() }],
      subject: `New-hire packet complete — ${invite.full_name}`,
      htmlContent: brandedEmail({
        preheader: `${invite.full_name} finished onboarding — packet attached.`,
        heading: 'New-Hire Packet Complete',
        bodyHtml:
          `<p style="margin:0 0 12px;"><strong>${invite.full_name}</strong>${invite.position_title ? ` (${invite.position_title})` : ''} completed their new-hire paperwork.</p>` +
          `<p style="margin:0;">The full packet — forms, tax elections, handbook acknowledgment, California notices, and the review audit log — is attached as a ZIP.</p>` +
          driveLine,
        note: 'Sensitive fields (SSN, bank) are included in the packet for payroll and should be handled accordingly.',
      }),
      attachment: [{ content: zipBuffer.toString('base64'), name: filename }],
    }),
  });
  if (!res.ok) return { ok: false, error: `Brevo ${res.status}: ${await res.text()}` };
  return { ok: true };
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };
  let admin;
  try { admin = getSupabaseAdmin(); } catch (e) { return { statusCode: 500, body: e.message }; }

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch { return { statusCode: 400, body: 'Bad JSON' }; }

  // Auth: internal secret (set by onboarding-public) must match the service key.
  const secret = (event.headers || {})['x-internal-secret'] || (event.headers || {})['X-Internal-Secret'];
  if (!secret || secret !== process.env.SUPABASE_SERVICE_ROLE_KEY) return { statusCode: 401, body: 'Unauthorized' };

  const token = String(body.token || '');
  if (!token) return { statusCode: 400, body: 'Missing token' };

  try {
    const { data: invite } = await admin.from('onboarding_invites').select('*').eq('token', token).maybeSingle();
    if (!invite) return { statusCode: 404, body: 'Not found' };

    const { data: sub } = await admin.from('onboarding_submissions').select('*').eq('invite_id', invite.id).maybeSingle();
    const { data: events } = await admin.from('onboarding_events').select('kind, ref, meta, created_at').eq('invite_id', invite.id).order('created_at', { ascending: true }).limit(5000);

    // Idempotency: bail if we've already finalized, unless forced.
    if (!body.force && (events || []).some((e) => e.kind === 'finalized')) {
      return { statusCode: 200, body: 'Already finalized' };
    }

    const files = await buildPacketFiles(invite, sub, events || []);
    const zipBuffer = await zipFiles(files); // emailed packet = generated PDFs only (keeps attachment small)
    const filename = `${safeName(invite.full_name)}_NSA_New_Hire_Packet.zip`;

    // The hire's uploaded documents (voided check, photo ID, …) — added to the
    // Drive copy so the Employee Forms folder is complete.
    const { data: docs } = await admin.from('onboarding_documents').select('kind, filename, storage_path').eq('invite_id', invite.id);
    const driveFiles = files.slice();
    for (const d of (docs || [])) {
      try {
        const dl = await admin.storage.from('onboarding-docs').download(d.storage_path);
        if (dl.data) { const ab = await dl.data.arrayBuffer(); driveFiles.push({ name: `Uploads/${d.kind}_${d.filename}`, bytes: Buffer.from(ab) }); }
      } catch {}
    }

    // 1) Google Drive copy (best-effort).
    let driveUrl = null;
    if (drive.isConfigured()) {
      try {
        const r = await drive.uploadPacketToDrive(invite.full_name, driveFiles);
        driveUrl = r.folderUrl;
        await admin.from('onboarding_events').insert([{ invite_id: invite.id, kind: 'drive_uploaded', ref: r.folderId, meta: { uploaded: r.uploaded, url: r.folderUrl } }]);
      } catch (e) {
        await admin.from('onboarding_events').insert([{ invite_id: invite.id, kind: 'drive_error', meta: { error: String(e.message || e) } }]);
      }
    }

    // 2) Email the packet to HR (best-effort).
    try {
      const mail = await emailPacketToHr(invite, zipBuffer, filename, driveUrl);
      await admin.from('onboarding_events').insert([{ invite_id: invite.id, kind: mail.ok ? 'email_sent' : 'email_error', ref: HR_EMAIL(), meta: mail.ok ? {} : { error: mail.error } }]);
    } catch (e) {
      await admin.from('onboarding_events').insert([{ invite_id: invite.id, kind: 'email_error', meta: { error: String(e.message || e) } }]);
    }

    await admin.from('onboarding_events').insert([{ invite_id: invite.id, kind: 'finalized', meta: { drive: !!driveUrl } }]);
    return { statusCode: 200, body: 'OK' };
  } catch (e) {
    return { statusCode: 500, body: String(e.message || e) };
  }
};
