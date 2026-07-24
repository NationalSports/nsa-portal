// Long-running GPT Image worker for the Uniform Builder.
// Netlify recognizes the -background suffix and allows this function to keep
// working after the request function has returned a job id to the browser.

const { safeEqualStr } = require('./_shared');
const {
  downloadJson,
  ensureBucket,
  getSupabaseAdmin,
  uploadJson,
  uploadObject,
  validJobId,
} = require('./_uniform-ai-concept-store');
const { _runtime } = require('./uniform-ai-concept');

async function saveFailure(sb, jobId, error) {
  try {
    await uploadJson(sb, jobId, 'status.json', {
      ok: false,
      pending: false,
      status: 'failed',
      jobId,
      error: String(error && error.message || 'OpenAI could not create the visual concepts.').slice(0, 500),
      finishedAt: new Date().toISOString(),
    });
  } catch (statusError) {
    console.error('uniform-ai-concept-background could not save failure', statusError && statusError.message);
  }
}

exports.handler = async (event) => {
  let body = {};
  try {
    body = JSON.parse(event.body || '{}');
  } catch (_error) {
    return { statusCode: 400, body: 'Invalid request' };
  }
  const jobId = validJobId(body.jobId);
  if (!jobId) return { statusCode: 400, body: 'Invalid job id' };

  const sb = getSupabaseAdmin();
  try {
    await ensureBucket(sb);
    const request = await downloadJson(sb, jobId, 'request.json');
    const provided = event.headers && (event.headers['x-job-token'] || event.headers['X-Job-Token']);
    if (!request.workerToken || !safeEqualStr(provided, request.workerToken)) {
      return { statusCode: 401, body: 'Unauthorized' };
    }
    await uploadJson(sb, jobId, 'status.json', {
      ok: true,
      pending: true,
      status: 'processing',
      jobId,
      startedAt: new Date().toISOString(),
    });

    const referenceImages = (Array.isArray(request.referenceImages) ? request.referenceImages : [])
      .map((image) => ({
        mediaType: String(image.mediaType || ''),
        bytes: Buffer.from(String(image.data || ''), 'base64'),
      }))
      .filter((image) => /^image\/(?:png|jpeg|webp)$/.test(image.mediaType) && image.bytes.length)
      .slice(0, 3);
    const response = await _runtime.openAiRequest({
      apiKey: process.env.OPENAI_API_KEY,
      prompt: String(request.conceptPrompt || ''),
      referenceImages,
      count: Math.min(3, Math.max(1, Number(request.count) || 3)),
    });
    const requestId = response.headers.get('x-request-id') || '';
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = data && data.error && data.error.message;
      const failure = new Error(message || `OpenAI image generation failed (${response.status})`);
      failure.reason = data && data.error && data.error.code;
      throw failure;
    }

    const concepts = [];
    for (const item of (Array.isArray(data.data) ? data.data : [])) {
      if (!item || !item.b64_json) continue;
      const index = concepts.length + 1;
      const name = `concept-${index}.jpg`;
      const bytes = Buffer.from(item.b64_json, 'base64');
      if (!bytes.length) continue;
      await uploadObject(sb, jobId, name, bytes, 'image/jpeg');
      concepts.push({
        id: `concept-${index}`,
        name: `Visual ${index}`,
        objectName: name,
        revisedPrompt: String(item.revised_prompt || '').slice(0, 1200),
      });
    }
    if (!concepts.length) throw new Error('OpenAI returned no concept images.');

    await uploadJson(sb, jobId, 'result.json', {
      concepts,
      model: _runtime.MODEL,
      format: 'photorealistic-concept-image',
      requestId,
    });
    await uploadJson(sb, jobId, 'status.json', {
      ok: true,
      pending: false,
      status: 'complete',
      jobId,
      count: concepts.length,
      finishedAt: new Date().toISOString(),
    });
    console.log('uniform-ai-concept-background complete', jobId, concepts.length, requestId);
    return { statusCode: 200, body: JSON.stringify({ ok: true, jobId, count: concepts.length }) };
  } catch (error) {
    console.error('uniform-ai-concept-background failed', jobId, error && error.message);
    await saveFailure(sb, jobId, error);
    return { statusCode: 500, body: JSON.stringify({ ok: false, jobId }) };
  }
};
