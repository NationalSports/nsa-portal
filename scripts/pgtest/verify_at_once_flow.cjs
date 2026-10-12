// Entire run is offline: PGlite databases + local React/Jest, with fake paid
// checkout fields. Supplier/payment/shipping network integrations are not called.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const root = path.resolve(__dirname,'../..');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(),'at-once-proof-'));
function run(args, env) {
  const result = spawnSync(process.execPath,args,{cwd:root,env:{...process.env,...env},stdio:'inherit'});
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Verification failed (${result.status}): ${args[0]}`);
}
try {
  run([path.join(__dirname,'verify_at_once_pick_assignment.cjs')],{});
  for (const [type, script] of [['all_school','verify_all_school_pipeline.cjs'],['club','verify_club_pipeline.cjs']]) {
    run([path.join(__dirname,script)],{AT_ONCE_SNAPSHOT_FILE:path.join(scratch,type+'.json')});
  }
  run([require.resolve('react-scripts/bin/react-scripts.js'),'test','--watchAll=false','--runInBand','--runTestsByPath','src/__tests__/atOncePipeline.integration.test.js'],{CI:'true',AT_ONCE_SNAPSHOT_DIR:scratch});
} catch(error) {
  console.error(error.message); process.exitCode=1;
} finally {
  fs.rmSync(scratch,{recursive:true,force:true});
  if(fs.existsSync(scratch)) throw new Error('Scratch snapshot cleanup failed');
  console.log('PASS fake-order snapshot files wiped');
}
