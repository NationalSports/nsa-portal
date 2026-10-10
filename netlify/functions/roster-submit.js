// Retired legacy mail relay. Use authenticated roster-order-submit instead.
exports.handler = async () => ({statusCode:410,headers:{"Content-Type":"application/json"},body:JSON.stringify({ok:false,error:"This roster submission endpoint has been retired. Please use your signed-in coach portal."})});
