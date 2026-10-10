const {test}=require('node:test');
const assert=require('node:assert/strict');
const {finishedBatchItems,buildShowcaseReviewEmail}=require('../netlify/functions/_showcaseEmail');
test('email lists only completed members from the current batch, grouped by name and color',()=>{
 const members=[{webstore_product_id:'a',name:'Adidas Fleece Hood',color:'Navy'},{webstore_product_id:'b',name:'Adidas Fleece Hood',color:'White'},{webstore_product_id:'c',name:'Failed pants',color:'Navy'}];
 const families=[{request_id:'r',inputs:{notification_batch_id:'batch',members}},{request_id:'old',inputs:{notification_batch_id:'previous',members:[{webstore_product_id:'old',name:'Previous item'}]}}];
 const assets=[{webstore_product_id:'a',generation_request_id:'r',status:'review'},{webstore_product_id:'b',generation_request_id:'r',status:'approved'},{webstore_product_id:'c',generation_request_id:'r',status:'failed'},{webstore_product_id:'old',generation_request_id:'old',status:'review'}];
 assert.deepEqual(finishedBatchItems(assets,families,'batch'),[{name:'Adidas Fleece Hood',colors:['Navy','White'],count:2}]);
 assert.deepEqual(finishedBatchItems(assets,families,'unknown'),[]);
});
test('finished names and colorways are HTML escaped in completion emails',()=>{
 const email=buildShowcaseReviewEmail({store:{name:'Store'},rep:{name:'Rep'},summary:{review:1,approved:0,failed:0},reviewUrl:'https://example.com',finishedItems:[{name:'Hood <script>',colors:['Navy & Gold'],count:1}]});
 assert.match(email.html,/Finished items/);assert.match(email.html,/Hood &lt;script&gt;/);assert.match(email.html,/Navy &amp; Gold/);assert.match(email.html,/1 image\)/);
 assert.doesNotMatch(email.html,/<script>/);
});
