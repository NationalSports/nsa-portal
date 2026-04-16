// Netlify serverless function to proxy OMG shared report fetches (avoids CORS)
// Usage: /.netlify/functions/omg-report-proxy?id=48ff450f-30dc-46c0-5101-698fe5464e53
exports.handler = async (event) => {
  const reportId = event.queryStringParameters?.id;
  if (!reportId) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing report id parameter' }) };
  }

  // Validate UUID format to prevent injection
  if (!/^[a-f0-9-]{36}$/i.test(reportId)) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid report id format' }) };
  }

  const url = `https://report.ordermygear.com/reports/${reportId}`;

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
    });

    if (!response.ok) {
      return {
        statusCode: response.status,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: `OMG report API returned ${response.status}` }),
      };
    }

    const data = await response.text();
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=300',
      },
      body: data,
    };
  } catch (error) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: `Failed to fetch OMG report: ${error.message}` }),
    };
  }
};
