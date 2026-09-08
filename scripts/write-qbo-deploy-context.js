const fs = require('fs');
const path = require('path');

function writeDeployContext(env = process.env, write = fs.writeFileSync) {
  const context = ['production', 'deploy-preview', 'branch-deploy', 'dev'].includes(env.CONTEXT)
    ? env.CONTEXT : 'unknown';
  // Always overwrite, including cached/local builds. Failure must fail the
  // build rather than leave an earlier production stamp in a preview bundle.
  write(path.join(__dirname, '..', 'netlify', 'functions', '_qboDeployContext.json'), JSON.stringify({ context }) + '\n');
}
if (require.main === module) writeDeployContext();
module.exports = { writeDeployContext };
