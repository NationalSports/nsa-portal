// Netlify serverless function to proxy Vectorizer.AI API calls
// Keeps API credentials server-side, accepts base64 image from frontend
const zlib = require('zlib');

exports.handler = async (event) => {
  const start = Date.now();
  const log = (msg) => console.log(`[vectorizer-proxy] ${msg} (${Date.now() - start}ms)`);

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type,Accept-Encoding', 'Access-Control-Allow-Methods': 'POST' }, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  const apiId = process.env.VECTORIZER_AI_API_ID;
  const apiSecret = process.env.VECTORIZER_AI_API_SECRET;
  if (!apiId || !apiSecret) {
    return { statusCode: 500, headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: 'Vectorizer.AI API credentials not configured.' }) };
  }

  let body;
  try { body = JSON.parse(event.body); } catch { return { statusCode: 400, headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: 'Invalid JSON body' }) }; }

  const { imageBase64, mode, outputFormat, maxColors } = body;
  if (!imageBase64) {
    return { statusCode: 400, headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: 'Missing imageBase64' }) };
  }

  log(`Received image: ${Math.round(imageBase64.length / 1024)}KB base64, mode=${mode}, colors=${maxColors}`);

  try {
    const imageBuffer = Buffer.from(imageBase64, 'base64');
    log(`Decoded to ${Math.round(imageBuffer.length / 1024)}KB binary`);

    // Build multipart form data
    const boundary = '----VectorizerBoundary' + Date.now();
    const parts = [];

    parts.push(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="image"; filename="image.png"\r\n` +
      `Content-Type: application/octet-stream\r\n\r\n`
    );
    parts.push(imageBuffer);
    parts.push('\r\n');

    parts.push(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="mode"\r\n\r\n` +
      `${mode || 'production'}\r\n`
    );

    parts.push(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="output.file_format"\r\n\r\n` +
      `${outputFormat || 'svg'}\r\n`
    );

    if (maxColors && maxColors > 0) {
      parts.push(
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="output.color_count"\r\n\r\n` +
        `${maxColors}\r\n`
      );
    }

    parts.push(`--${boundary}--\r\n`);

    const bodyParts = parts.map(p => typeof p === 'string' ? Buffer.from(p) : p);
    const formBody = Buffer.concat(bodyParts);
    log(`Sending ${Math.round(formBody.length / 1024)}KB to Vectorizer.AI API`);

    const resp = await fetch('https://api.vectorizer.ai/api/v1/vectorize', {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + Buffer.from(apiId + ':' + apiSecret).toString('base64'),
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
      },
      body: formBody,
    });

    log(`API responded: ${resp.status} ${resp.statusText}`);

    if (!resp.ok) {
      const errText = await resp.text();
      log(`API error: ${errText.substring(0, 500)}`);
      let errMsg;
      try { errMsg = JSON.parse(errText).error?.message || errText; } catch { errMsg = errText; }
      return { statusCode: resp.status, headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: errMsg }) };
    }

    const resultBuffer = Buffer.from(await resp.arrayBuffer());
    const creditsCharged = resp.headers.get('x-credits-charged') || '';
    log(`Got result: ${Math.round(resultBuffer.length / 1024)}KB, credits=${creditsCharged}`);

    if ((outputFormat || 'svg') === 'svg') {
      const svg = resultBuffer.toString('utf-8');
      const responseBody = JSON.stringify({ svg, creditsCharged });

      // If response is too large, return gzipped with isBase64Encoded
      if (responseBody.length > 5 * 1024 * 1024) {
        log(`Response too large (${Math.round(responseBody.length / 1024)}KB), compressing`);
        const compressed = zlib.gzipSync(Buffer.from(responseBody));
        return {
          statusCode: 200,
          isBase64Encoded: true,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Content-Type': 'application/json',
            'Content-Encoding': 'gzip',
          },
          body: compressed.toString('base64'),
        };
      }

      return {
        statusCode: 200,
        headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
        body: responseBody,
      };
    } else {
      return {
        statusCode: 200,
        headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: resultBuffer.toString('base64'), contentType: resp.headers.get('content-type') || 'application/octet-stream', creditsCharged }),
      };
    }
  } catch (error) {
    log(`CRASH: ${error.message}\n${error.stack}`);
    return { statusCode: 500, headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: 'Proxy error: ' + error.message }) };
  }
};
