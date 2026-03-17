// Netlify serverless function to check UPS tracking status
// Usage: /.netlify/functions/ups-tracking?tracking=1Z42Y2E003908348977
// Returns: { status, description, pickedUp, delivered, timestamp }
exports.handler = async (event) => {
  const tracking = event.queryStringParameters?.tracking;
  if (!tracking) {
    return { statusCode: 400, headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: 'Missing tracking parameter' }) };
  }

  // Validate UPS tracking number format
  if (!/^1Z/i.test(tracking)) {
    return { statusCode: 400, headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ error: 'Invalid UPS tracking number' }) };
  }

  try {
    // UPS public tracking endpoint (no API key required)
    const response = await fetch('https://webapis.ups.com/track/api/Track/GetStatus?loc=en_US', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0',
        'Origin': 'https://www.ups.com',
        'Referer': 'https://www.ups.com/track',
      },
      body: JSON.stringify({ Locale: 'en_US', TrackingNumber: [tracking] }),
    });

    if (!response.ok) {
      return {
        statusCode: 200,
        headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
        body: JSON.stringify({ tracking, status: 'unknown', pickedUp: false, delivered: false, error: 'UPS returned ' + response.status }),
      };
    }

    const data = await response.json();
    const pkg = data?.trackDetails?.[0];
    if (!pkg) {
      return {
        statusCode: 200,
        headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
        body: JSON.stringify({ tracking, status: 'not_found', pickedUp: false, delivered: false }),
      };
    }

    const statusDesc = (pkg.packageStatus || '').toLowerCase();
    const activities = pkg.shipmentProgressActivities || [];
    const latestActivity = activities[0]?.activityScan || '';

    // Determine pickup and delivery status from UPS status codes
    const delivered = statusDesc.includes('delivered');
    // "In Transit", "On the Way", "Out for Delivery", or any scan activity means carrier has it
    const pickedUp = delivered ||
      statusDesc.includes('in transit') ||
      statusDesc.includes('on the way') ||
      statusDesc.includes('out for delivery') ||
      statusDesc.includes('departed') ||
      activities.length > 1; // Multiple activities means UPS has scanned it

    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' },
      body: JSON.stringify({
        tracking,
        status: pkg.packageStatus || 'unknown',
        description: latestActivity,
        pickedUp,
        delivered,
        timestamp: activities[0]?.date || null,
        activityCount: activities.length,
      }),
    };
  } catch (error) {
    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
      body: JSON.stringify({ tracking, status: 'error', pickedUp: false, delivered: false, error: error.message }),
    };
  }
};
