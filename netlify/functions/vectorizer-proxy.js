// Netlify serverless function to proxy Vectorizer.AI API calls
// Keeps API credentials server-side, accepts base64 image from frontend
exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'POST' }, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  const apiId = process.env.VECTORIZER_AI_API_ID;
  const apiSecret = process.env.VECTORIZER_AI_API_SECRET;
  if (!apiId || !apiSecret) {
    return { statusCode: 500, headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: 'Vectorizer.AI API credentials not configured. Set VECTORIZER_AI_API_ID and VECTORIZER_AI_API_SECRET in Netlify env vars.' }) };
  }

  let body;
  try { body = JSON.parse(event.body); } catch { return { statusCode: 400, headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: 'Invalid JSON body' }) }; }

  const { imageBase64, mode, outputFormat } = body;
  if (!imageBase64) {
    return { statusCode: 400, headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: 'Missing imageBase64' }) };
  }

  try {
    const formData = new URLSearchParams();
    formData.append('image.base64', imageBase64);
    formData.append('output.file_format', outputFormat || 'svg');
    formData.append('mode', mode || 'production');

    const resp = await fetch('https://api.vectorizer.ai/api/v1/vectorize', {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + Buffer.from(apiId + ':' + apiSecret).toString('base64'),
      },
      body: formData,
    });

    if (!resp.ok) {
      const errText = await resp.text();
      let errMsg;
      try { errMsg = JSON.parse(errText).error?.message || errText; } catch { errMsg = errText; }
      return { statusCode: resp.status, headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: errMsg }) };
    }

    const resultBuffer = Buffer.from(await resp.arrayBuffer());
    const contentType = resp.headers.get('content-type') || 'image/svg+xml';
    const creditsCharged = resp.headers.get('x-credits-charged') || '';

    // SVG is text, return as-is; other formats return as base64
    if ((outputFormat || 'svg') === 'svg') {
      return {
        statusCode: 200,
        headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
        body: JSON.stringify({ svg: resultBuffer.toString('utf-8'), creditsCharged }),
      };
    } else {
      return {
        statusCode: 200,
        headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: resultBuffer.toString('base64'), contentType, creditsCharged }),
      };
    }
  } catch (error) {
    return { statusCode: 500, headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: 'Proxy error: ' + error.message }) };
  }
};
