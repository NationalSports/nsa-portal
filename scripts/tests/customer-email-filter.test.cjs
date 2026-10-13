const {test}=require('node:test');
const assert=require('node:assert/strict');
const {exclusionReason}=require('../../netlify/functions/_customerEmailFilter');
test('excludes company domains and internal Gmail addresses',()=>{
 assert.equal(exclusionReason({sender_email:'Vic@nationalsportsapparel.com'}),'Internal team email');
 assert.equal(exclusionReason({sender_email:'nsashipping1@gmail.com'}),'Internal team email');
 assert.equal(exclusionReason({sender_email:'staff@gmail.com'},['staff@gmail.com']),'Internal team email');
});
test('excludes supplier email and business domains but never all Gmail users',()=>{
 assert.equal(exclusionReason({sender_email:'billing@vendor.com'},[],['sales@vendor.com']),'Supplier email');
 assert.equal(exclusionReason({sender_email:'coach@gmail.com'},[],['vendor@gmail.com']),null);
 assert.equal(exclusionReason({sender_email:'quickbooks@notification.intuit.com'}),'Automated vendor notification');
});
test('keeps unknown coaches for customer classification',()=>{
 assert.equal(exclusionReason({sender_email:'coach@school.edu'}),null);
 assert.equal(exclusionReason({sender_email:'karlqwilson@gmail.com'}),null);
});
