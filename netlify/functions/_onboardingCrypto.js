// App-layer encryption for the most sensitive onboarding fields (SSN, bank
// account/routing). These are AES-256-GCM encrypted here BEFORE they are written
// to onboarding_submissions.sensitive, and only ever decrypted server-side when
// HR generates the final ZIP. A raw database read therefore never exposes
// plaintext SSNs or bank numbers.
//
// Key: ONBOARDING_ENC_KEY — a 32-byte key provided as base64 or hex in the
// Netlify environment. Generate one with:  openssl rand -base64 32
const crypto = require('crypto');

// envName lets other server-only secrets (e.g. rep Google refresh tokens,
// GOOGLE_TOKEN_ENC_KEY) reuse this AES-256-GCM helper under their own key.
function getKey(envName = 'ONBOARDING_ENC_KEY') {
  const raw = process.env[envName] || '';
  if (!raw) throw new Error(`${envName} is not set`);
  let key;
  if (/^[0-9a-fA-F]{64}$/.test(raw)) key = Buffer.from(raw, 'hex');
  else key = Buffer.from(raw, 'base64');
  if (key.length !== 32) throw new Error(`${envName} must decode to 32 bytes`);
  return key;
}

// Encrypt a string → { iv, tag, ct } (all base64). Returns null for empty input.
function encryptField(plaintext, envName) {
  if (plaintext == null || plaintext === '') return null;
  const key = getKey(envName);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { iv: iv.toString('base64'), tag: tag.toString('base64'), ct: ct.toString('base64') };
}

// Decrypt { iv, tag, ct } → string. Returns '' for null/invalid input.
function decryptField(blob, envName) {
  if (!blob || !blob.iv || !blob.ct || !blob.tag) return '';
  const key = getKey(envName);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(blob.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(blob.tag, 'base64'));
  const pt = Buffer.concat([decipher.update(Buffer.from(blob.ct, 'base64')), decipher.final()]);
  return pt.toString('utf8');
}

// Mask a decrypted SSN/account for display in audit views (show last 4 only).
function maskTail(value, keep = 4) {
  const s = String(value || '');
  if (s.length <= keep) return s ? '•'.repeat(s.length) : '';
  return '•••• ' + s.slice(-keep);
}

function hasEncKey(envName) {
  try { getKey(envName); return true; } catch { return false; }
}

module.exports = { encryptField, decryptField, maskTail, hasEncKey };
