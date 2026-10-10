const { test } = require('node:test');
const assert = require('node:assert/strict');
const { anchoredPlacement, usesTorsoAnchors } = require('../netlify/functions/_showcasePlacementAnchors');
const { validatedMapping } = require('../netlify/functions/_showcaseFamily');
const source = { neck:[.5,.34], hem:[.5,.9], left:[.25,.43], right:[.75,.43] };
const target = { neck:[.5,.18], hem:[.5,.9], left:[.28,.296], right:[.72,.296] };
const p = { x:50, y:43, w:30, torso_anchored:true };
const close = (a,b) => assert.ok(Math.abs(a-b)<1e-9, `${a} != ${b}`);
test('lowered hood preserves neckline-to-hem position instead of copying image height', () => {
  const quad = anchoredPlacement(p,{source,target});
  const centerY = quad.reduce((sum,point)=>sum+point[1],0)/4;
  close((centerY-.18)/(.9-.18),(.43-.34)/(.9-.34));
  close(quad[1][0]-quad[0][0], .30/.50*.44);
  assert.ok(centerY<.31); // old same-frame placement at .43 is visibly too low
});
test('identity transfer retains 4:5 padding, square size, and an off-center saved placement', () => {
  const quad=anchoredPlacement({...p,x:55},{source,target:source});
  for (const [i,point] of [[.40,.31],[.70,.31],[.70,.55],[.40,.55]].entries()) point.forEach((v,j)=>close(quad[i][j],v));
});
test('slight hero tilt follows the torso axes and preserves the saved center', () => {
  const tilted={neck:[.48,.18],hem:[.56,.9],left:[.27,.3],right:[.73,.32]};
  const quad=anchoredPlacement(p,{source,target:tilted});
  const fraction=(.43-.34)/(.9-.34);
  close(quad.reduce((n,v)=>n+v[0],0)/4,.48+fraction*.08);
  close(quad.reduce((n,v)=>n+v[1],0)/4,.18+fraction*.72);
});
test('missing, swapped and out-of-torso landmarks fail explicitly', () => {
  assert.throws(()=>anchoredPlacement(p,{}),/landmarks/);
  assert.throws(()=>anchoredPlacement(p,{source,target:{...target,left:target.right,right:target.left}}),/orientation/);
  assert.throws(()=>anchoredPlacement({...p,y:10},{source,target}),/outside/);
  assert.equal(usesTorsoAnchors({name:'Nike Women’s Pullover Hoodie'},{placement:'full_front'}),true);
  assert.equal(usesTorsoAnchors({name:'Nike Jogger'},{placement:'full_front'}),false);
  assert.equal(usesTorsoAnchors({name:'Nike Hoodie'},{placement:'left_chest'}),false);
});
test('mapping overrides an incorrect guessed quad with anchored coordinates and retries missing landmarks', async () => {
  let calls=0;
  const result=await validatedMapping(async()=>({analysis:{supported:true,protected_regions:[],logo_occluders:[],logo_strands:[],placements:{p1:[[.3,.4],[.7,.4],[.7,.7],[.3,.7]]},torso_anchors:++calls===1?{}:{p1:{source,target}}}}),{analysisPrompt:'Map'},{p1:p},async()=>{});
  assert.equal(calls,2);
  assert.deepEqual(result.analysis.placements.p1,anchoredPlacement(p,{source,target}));
});
