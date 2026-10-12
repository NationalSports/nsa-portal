// This branch is deployed only on the separate staging Netlify site. Fail closed
// if its build environment is ever pointed at production or given operational keys.
const expectedUrl = 'https://bmqjxehuxzsgpqzanuog.supabase.co';
const env = process.env;
const failures = [];

if (env.STAGING_SITE !== '1') failures.push('STAGING_SITE must be 1');
if (env.REACT_APP_SUPABASE_URL !== expectedUrl) failures.push('Supabase URL must be the staging project');
if (!env.REACT_APP_SUPABASE_ANON_KEY) failures.push('Staging publishable key is missing');
if (env.PUBLIC_URL !== '/') failures.push('PUBLIC_URL must use relative staging assets');
if (env.REACT_APP_SO_EDIT_LEASES !== '1') failures.push('Order edit leases must be enabled');

const forbidden = /(?:SERVICE_ROLE|SECRET|PRIVATE_KEY|PASSWORD|TOKEN|API_KEY|CLIENT_SECRET|WEBHOOK|ADMIN_PW_HASH|PILOT_ORDER_ID)/i;
const operational = /^(?:QBO|QB_|QUICKBOOK|STRIPE|SHIPSTATION|BREVO|GMAIL|GOOGLE_|SLACK|SANMAR|ADIDAS|UPS_|TAXCLOUD|ANTHROPIC|OPENAI|SILVERSCREEN|SPORTSLINK|SS_|UA_|PROD_)/i;
for (const [key, value] of Object.entries(env)) {
  if (!value) continue;
  if (key === 'REACT_APP_SUPABASE_ANON_KEY') continue;
  if (key.startsWith('SUPABASE_') || key.startsWith('REACT_APP_') && forbidden.test(key) || operational.test(key)) {
    failures.push(`Forbidden credential or integration setting: ${key}`);
  }
}

if (failures.length) {
  console.error('Unsafe staging build:\n' + failures.map((failure) => `- ${failure}`).join('\n'));
  process.exit(1);
}
console.log('Staging environment check passed.');
