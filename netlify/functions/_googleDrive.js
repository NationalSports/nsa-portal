// Minimal Google Drive writer for the onboarding finalize step. Authenticates
// as a Google service account (JWT → OAuth access token) and creates a folder /
// uploads files via the Drive REST API — no heavyweight googleapis dependency.
//
// Required env (all optional — if unset, Drive upload is skipped gracefully):
//   GOOGLE_SA_EMAIL        service account email (…@…iam.gserviceaccount.com)
//   GOOGLE_SA_PRIVATE_KEY  the service account's PEM private key (\n-escaped is fine)
//   EMPLOYEE_FORMS_FOLDER_ID  Drive folder id to nest per-hire folders under
//                             (the shared "Employee Forms" folder)
// The "Employee Forms" folder must be shared with GOOGLE_SA_EMAIL as Editor.
const crypto = require('crypto');

function isConfigured() {
  return !!(process.env.GOOGLE_SA_EMAIL && process.env.GOOGLE_SA_PRIVATE_KEY && process.env.EMPLOYEE_FORMS_FOLDER_ID);
}

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function getAccessToken() {
  const email = process.env.GOOGLE_SA_EMAIL;
  const key = (process.env.GOOGLE_SA_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  const iat = Math.floor(Date.now() / 1000);
  const claims = {
    iss: email,
    scope: 'https://www.googleapis.com/auth/drive',
    aud: 'https://oauth2.googleapis.com/token',
    iat, exp: iat + 3600,
  };
  const header = { alg: 'RS256', typ: 'JWT' };
  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claims))}`;
  const signature = crypto.createSign('RSA-SHA256').update(signingInput).sign(key);
  const jwt = `${signingInput}.${b64url(signature)}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }),
  });
  if (!res.ok) throw new Error(`Drive auth failed (${res.status}): ${await res.text()}`);
  return (await res.json()).access_token;
}

const COMMON = 'supportsAllDrives=true&includeItemsFromAllDrives=true';

// Find a subfolder by name under parentId, or create it. Returns its id.
async function findOrCreateFolder(token, name, parentId) {
  const safe = String(name).replace(/'/g, "\\'");
  const q = encodeURIComponent(`name='${safe}' and mimeType='application/vnd.google-apps.folder' and '${parentId}' in parents and trashed=false`);
  const listRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)&${COMMON}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (listRes.ok) {
    const found = (await listRes.json()).files;
    if (found && found.length) return found[0].id;
  }
  const createRes = await fetch(`https://www.googleapis.com/drive/v3/files?${COMMON}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] }),
  });
  if (!createRes.ok) throw new Error(`Drive folder create failed (${createRes.status}): ${await createRes.text()}`);
  return (await createRes.json()).id;
}

// Multipart upload of a single file (bytes) into folderId.
async function uploadFile(token, folderId, name, bytes, mimeType = 'application/pdf') {
  const boundary = 'nsa_onb_' + crypto.randomBytes(8).toString('hex');
  const meta = JSON.stringify({ name, parents: [folderId] });
  const head = Buffer.from(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n` +
    `--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`, 'utf8');
  const tail = Buffer.from(`\r\n--${boundary}--`, 'utf8');
  const body = Buffer.concat([head, Buffer.from(bytes), tail]);

  const res = await fetch(`https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&${COMMON}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': `multipart/related; boundary=${boundary}` },
    body,
  });
  if (!res.ok) throw new Error(`Drive upload failed for ${name} (${res.status}): ${await res.text()}`);
  return (await res.json()).id;
}

// Create (or reuse) a per-hire folder and upload all packet files into it.
// Returns { folderId, folderUrl, uploaded } or throws.
async function uploadPacketToDrive(folderName, files) {
  const token = await getAccessToken();
  const parent = process.env.EMPLOYEE_FORMS_FOLDER_ID;
  const folderId = await findOrCreateFolder(token, folderName, parent);
  let uploaded = 0;
  for (const f of files) { await uploadFile(token, folderId, f.name, f.bytes); uploaded++; }
  return { folderId, folderUrl: `https://drive.google.com/drive/folders/${folderId}`, uploaded };
}

module.exports = { isConfigured, uploadPacketToDrive, getAccessToken, findOrCreateFolder, uploadFile };
