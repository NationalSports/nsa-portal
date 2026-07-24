// Private, short-lived storage for asynchronous uniform concept jobs.
//
// A normal Netlify function cannot wait long enough for GPT Image to finish.
// The request function therefore stores the job here, starts a Netlify
// background function, and the browser polls a small status endpoint.

const { getSupabaseAdmin } = require('./_shared');

const BUCKET = 'uniform-ai-concepts';
const JOB_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function validJobId(value) {
  const id = String(value || '').trim();
  return JOB_ID.test(id) ? id : '';
}

async function ensureBucket(sb) {
  const { data, error } = await sb.storage.getBucket(BUCKET);
  if (data) return;
  if (error && !/not found|does not exist/i.test(String(error.message || ''))) {
    throw new Error(`Concept storage lookup failed: ${error.message}`);
  }
  const { error: createError } = await sb.storage.createBucket(BUCKET, {
    public: false,
    fileSizeLimit: '30MB',
    allowedMimeTypes: ['application/json', 'image/jpeg', 'image/png', 'image/webp'],
  });
  if (createError && !/already exists|duplicate/i.test(String(createError.message || ''))) {
    throw new Error(`Concept storage setup failed: ${createError.message}`);
  }
}

function objectPath(jobId, name) {
  const id = validJobId(jobId);
  if (!id) throw new Error('Invalid concept job id');
  return `jobs/${id}/${name}`;
}

async function uploadObject(sb, jobId, name, data, contentType) {
  const { error } = await sb.storage.from(BUCKET).upload(
    objectPath(jobId, name),
    data,
    { contentType, cacheControl: '0', upsert: true },
  );
  if (error) throw new Error(`Concept storage write failed: ${error.message}`);
}

async function uploadJson(sb, jobId, name, value) {
  await uploadObject(
    sb,
    jobId,
    name,
    Buffer.from(JSON.stringify(value)),
    'application/json',
  );
}

async function downloadObject(sb, jobId, name) {
  const { data, error } = await sb.storage.from(BUCKET).download(objectPath(jobId, name));
  if (error || !data) throw new Error(`Concept storage read failed: ${error ? error.message : 'missing object'}`);
  return Buffer.from(await data.arrayBuffer());
}

async function downloadJson(sb, jobId, name) {
  return JSON.parse((await downloadObject(sb, jobId, name)).toString('utf8'));
}

async function createJob(jobId, request) {
  const sb = getSupabaseAdmin();
  await ensureBucket(sb);
  await uploadJson(sb, jobId, 'request.json', request);
  await uploadJson(sb, jobId, 'status.json', {
    ok: true,
    pending: true,
    status: 'queued',
    jobId,
    createdAt: new Date().toISOString(),
  });
}

module.exports = {
  BUCKET,
  createJob,
  downloadJson,
  downloadObject,
  ensureBucket,
  getSupabaseAdmin,
  uploadJson,
  uploadObject,
  validJobId,
};
