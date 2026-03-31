// Netlify serverless function to proxy Brevo transactional email API calls
// Keeps the BREVO_API_KEY server-side only (not exposed to the browser)
//
// Environment variables required:
//   BREVO_API_KEY — your Brevo API key
//
// Accepts POST with the same JSON payload you'd send to Brevo's /v3/smtp/email

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Method not allowed. Use POST.' }) };
  }

  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'BREVO_API_KEY not configured in environment variables' }) };
  }

  try {
    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'accept': 'application/json',
        'content-type': 'application/json',
        'api-key': apiKey,
      },
      body: event.body,
    });

    const data = await response.text();

    return {
      statusCode: response.status,
      headers: { 'Content-Type': 'application/json' },
      body: data,
    };
  } catch (error) {
    return { statusCode: 500, headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: `Brevo API call failed: ${error.message}` }) };
  }
};
