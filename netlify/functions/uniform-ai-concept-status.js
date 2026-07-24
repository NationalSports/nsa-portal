// Polling endpoint for asynchronous Uniform Builder image concepts.

const { corsHeaders } = require('./_shared');
const {
  downloadJson,
  downloadObject,
  getSupabaseAdmin,
  validJobId,
} = require('./_uniform-ai-concept-store');

exports.handler = async (event) => {
  const headers = {
    ...corsHeaders(),
    'Cache-Control': 'no-store',
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'GET' && event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ ok: false, error: 'GET or POST only' }) };
  }
  let requestedId = event.queryStringParameters && event.queryStringParameters.jobId;
  if (!requestedId && event.httpMethod === 'POST') {
    try {
      requestedId = JSON.parse(event.body || '{}').jobId;
    } catch (_error) {
      requestedId = '';
    }
  }
  const jobId = validJobId(requestedId);
  if (!jobId) {
    return { statusCode: 400, headers, body: JSON.stringify({ ok: false, error: 'Invalid concept job.' }) };
  }

  try {
    const sb = getSupabaseAdmin();
    const status = await downloadJson(sb, jobId, 'status.json');
    if (status.status !== 'complete') {
      return { statusCode: 200, headers, body: JSON.stringify(status) };
    }

    const result = await downloadJson(sb, jobId, 'result.json');
    const concepts = [];
    for (const concept of (Array.isArray(result.concepts) ? result.concepts : [])) {
      const bytes = await downloadObject(sb, jobId, concept.objectName);
      concepts.push({
        id: concept.id,
        name: concept.name,
        image: `data:image/jpeg;base64,${bytes.toString('base64')}`,
        revisedPrompt: concept.revisedPrompt || '',
      });
    }
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        ok: true,
        pending: false,
        status: 'complete',
        jobId,
        concepts,
        model: result.model,
        format: result.format,
        requestId: result.requestId,
      }),
    };
  } catch (error) {
    console.error('uniform-ai-concept-status failed', jobId, error && error.message);
    return {
      statusCode: 404,
      headers,
      body: JSON.stringify({ ok: false, error: 'Concept job was not found. Please create new concepts.' }),
    };
  }
};
