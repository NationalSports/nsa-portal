// Netlify serverless function to proxy external images (avoids CORS for canvas rendering)
// Usage: /.netlify/functions/image-proxy?url=https://cdnm.sanmar.com/...
exports.handler = async (event) => {
  const url = event.queryStringParameters?.url;
  if (!url) {
    return { statusCode: 400, body: 'Missing url parameter' };
  }

  // Only allow known supplier image domains
  const allowed = ['cdnm.sanmar.com', 'sanmar.com', 'ssactivewear.com', 'cdnl.ssactivewear.com', 'www.momentecbrands.com', 'momentecbrands.com'];
  let hostname;
  try { hostname = new URL(url).hostname; } catch { return { statusCode: 400, body: 'Invalid url' }; }
  if (!allowed.some(d => hostname === d || hostname.endsWith('.' + d))) {
    return { statusCode: 403, body: 'Domain not allowed' };
  }

  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': 'NSA-Portal/1.0' },
    });
    if (!response.ok) {
      return { statusCode: response.status, body: `Upstream error: ${response.status}` };
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    const contentType = response.headers.get('content-type') || 'image/jpeg';
    return {
      statusCode: 200,
      headers: {
        'Content-Type': contentType,
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=86400',
      },
      body: buffer.toString('base64'),
      isBase64Encoded: true,
    };
  } catch (error) {
    return { statusCode: 500, body: `Proxy error: ${error.message}` };
  }
};
