// Netlify serverless function for AI-powered portal search
// Proxies requests to Claude API so the key stays server-side

const corsHeaders = () => ({
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
});

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders(), body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: corsHeaders(), body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const apiKey = process.env.CLAUDE_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, headers: corsHeaders(), body: JSON.stringify({ error: 'CLAUDE_API_KEY not configured. Add it to Netlify env vars.' }) };
  }

  try {
    const { query, context } = JSON.parse(event.body || '{}');
    if (!query) {
      return { statusCode: 400, headers: corsHeaders(), body: JSON.stringify({ error: 'Missing query' }) };
    }

    const systemPrompt = `You are an AI search assistant for National Sports Apparel's internal portal. The portal manages sales orders, estimates, invoices, customers, products, production jobs, and vendors for a custom apparel company.

You have two jobs:
1. **Find records** — When a rep asks about a specific order, customer, product, etc., search through the provided data and return matching results.
2. **Answer questions** — When a rep asks how something works in the portal or about business processes, give a clear, concise answer.

PORTAL DATA (current snapshot):
${context}

RESPONSE FORMAT — You MUST respond with valid JSON matching one of these:

For record searches:
{
  "type": "results",
  "summary": "Brief description of what you found",
  "results": [
    {
      "kind": "order|estimate|invoice|customer|product|job|vendor",
      "id": "the record ID (e.g. SO-1234, EST-100, INV-50)",
      "title": "short display title",
      "detail": "1-2 sentence description with key info",
      "customer_id": "customer UUID if applicable"
    }
  ]
}

For help/questions:
{
  "type": "answer",
  "answer": "Your clear, concise answer (use markdown for formatting)"
}

If nothing matches:
{
  "type": "results",
  "summary": "No results found for your search",
  "results": []
}

IMPORTANT:
- Be fuzzy/smart with matching. "Servite basketball reversible from 2 years ago" should match orders for Servite (customer) with basketball reversibles even if the exact words differ.
- Time references like "2 years ago", "last month", "recently" should be interpreted relative to today's date.
- Today's date is ${new Date().toISOString().slice(0, 10)}.
- Return up to 10 most relevant results, ordered by relevance.
- ONLY return valid JSON — no markdown wrapping, no extra text.`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1500,
        system: systemPrompt,
        messages: [{ role: 'user', content: query }],
      }),
    });

    if (!response.ok) {
      const errBody = await response.text();
      console.error('[Claude API] Error:', response.status, errBody);
      return { statusCode: 502, headers: corsHeaders(), body: JSON.stringify({ error: 'Claude API error: ' + response.status }) };
    }

    const data = await response.json();
    const text = data.content?.[0]?.text || '{}';

    // Parse the JSON response from Claude
    let parsed;
    try {
      // Strip markdown code fences if Claude wraps them
      const cleaned = text.replace(/^```json?\s*/i, '').replace(/\s*```$/i, '').trim();
      parsed = JSON.parse(cleaned);
    } catch (e) {
      // If JSON parsing fails, return as a text answer
      parsed = { type: 'answer', answer: text };
    }

    return { statusCode: 200, headers: corsHeaders(), body: JSON.stringify(parsed) };
  } catch (err) {
    console.error('[claude-search] Error:', err);
    return { statusCode: 500, headers: corsHeaders(), body: JSON.stringify({ error: err.message }) };
  }
};
