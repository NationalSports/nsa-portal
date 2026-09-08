// Netlify CONTEXT exists at build time, not Lambda runtime. The postbuild
// script stamps this bundled file; the checked-in fallback denies execution.
const deployment = require('./_qboDeployContext.json');
function reviewEnabled(env = process.env) {
  return deployment.context === 'production' && env.QBO_SERVER_REVIEW_ENABLED === 'true'
    && /^\d+$/.test(env.QBO_REVIEW_REALM_ID || '');
}
module.exports = { reviewEnabled };
