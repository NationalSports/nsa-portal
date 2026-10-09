const {test}=require('node:test');
const assert=require('node:assert/strict');
const {analysisRequest}=require('../netlify/functions/_showcaseAnalysisRequest');
const res=(status,retry)=>({ok:status===200,status,headers:{get:()=>retry},json:async()=>status===200?{id:'ok'}:{error:{message:'overloaded'}}});
test('overload retries honor Retry-After and return the successful analysis',async()=>{
 let calls=0,checks=0;const delays=[];
 const result=await analysisRequest('endpoint',{}, {fetchImpl:async()=>res(++calls===1?429:200,'5'),sleep:async ms=>delays.push(ms),beforeAttempt:async()=>checks++});
 assert.equal(result.id,'ok');assert.equal(calls,2);assert.equal(checks,2);assert.deepEqual(delays,[5000]);
});
test('persistent overload is bounded and does not report a garment-placement defect',async()=>{
 let calls=0;
 await assert.rejects(analysisRequest('endpoint',{}, {fetchImpl:async()=>{calls++;return res(503)},sleep:async()=>{}}),/temporarily unavailable after automatic retries/);
 assert.equal(calls,4);
});
test('cancellation stops the next provider call, while permanent errors do not retry',async()=>{
 let checks=0,calls=0;
 await assert.rejects(analysisRequest('endpoint',{}, {fetchImpl:async()=>{calls++;return res(429)},sleep:async()=>{},beforeAttempt:async()=>{if(++checks===2)throw Error('canceled')}}),/canceled/);
 assert.equal(calls,1);
 await assert.rejects(analysisRequest('endpoint',{}, {fetchImpl:async()=>res(401),sleep:async()=>{throw Error('must not retry')}}),/401/);
});
test('transport failures retry and a long cooldown never triggers an early request',async()=>{
 let calls=0;assert.equal((await analysisRequest('endpoint',{}, {fetchImpl:async()=>{if(++calls===1)throw Error('network');return res(200)},sleep:async()=>{}})).id,'ok');
 await assert.rejects(analysisRequest('endpoint',{}, {fetchImpl:async()=>res(429,'120'),sleep:async()=>{throw Error('must not retry early')}}),/longer cooldown/);
});
