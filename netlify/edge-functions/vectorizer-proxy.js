// Netlify Edge Function to proxy Vectorizer.AI API calls
// Edge functions have 50s timeout vs 10s for regular functions
export default async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('', {
      status: 200,
      headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'POST' },
    });
  }
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const apiId = Deno.env.get('VECTORIZER_AI_API_ID');
  const apiSecret = Deno.env.get('VECTORIZER_AI_API_SECRET');
  if (!apiId || !apiSecret) {
    return new Response(JSON.stringify({ error: 'Vectorizer.AI API credentials not configured.' }), {
      status: 500,
      headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
    });
  }

  let body;
  try { body = await request.json(); } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
    });
  }

  const { imageBase64, mode, outputFormat, maxColors } = body;
  if (!imageBase64) {
    return new Response(JSON.stringify({ error: 'Missing imageBase64' }), {
      status: 400,
      headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
    });
  }

  try {
    // Decode base64 to binary
    const binaryStr = atob(imageBase64);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);

    // Build multipart form data
    const formData = new FormData();
    formData.append('image', new Blob([bytes], { type: 'image/png' }), 'image.png');
    formData.append('mode', mode || 'production');
    formData.append('output.file_format', outputFormat || 'svg');
    if (maxColors && maxColors > 0) {
      formData.append('output.color_count', String(maxColors));
    }

    const resp = await fetch('https://api.vectorizer.ai/api/v1/vectorize', {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + btoa(apiId + ':' + apiSecret),
      },
      body: formData,
    });

    if (!resp.ok) {
      const errText = await resp.text();
      let errMsg;
      try { errMsg = JSON.parse(errText).error?.message || errText; } catch { errMsg = errText; }
      return new Response(JSON.stringify({ error: errMsg }), {
        status: resp.status,
        headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
      });
    }

    const resultBuffer = await resp.arrayBuffer();
    const creditsCharged = resp.headers.get('x-credits-charged') || '';

    if ((outputFormat || 'svg') === 'svg') {
      const svg = new TextDecoder().decode(resultBuffer);
      return new Response(JSON.stringify({ svg, creditsCharged }), {
        status: 200,
        headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
      });
    } else {
      // Convert binary to base64 for non-SVG formats
      const uint8 = new Uint8Array(resultBuffer);
      let binary = '';
      for (let i = 0; i < uint8.length; i++) binary += String.fromCharCode(uint8[i]);
      const data = btoa(binary);
      const contentType = resp.headers.get('content-type') || 'application/octet-stream';
      return new Response(JSON.stringify({ data, contentType, creditsCharged }), {
        status: 200,
        headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
      });
    }
  } catch (error) {
    return new Response(JSON.stringify({ error: 'Proxy error: ' + error.message }), {
      status: 500,
      headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
    });
  }
};

export const config = {
  path: '/api/vectorizer-proxy',
};
