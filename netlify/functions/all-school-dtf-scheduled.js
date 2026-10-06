const { handler } = require('./all-school-dtf');

exports.handler = event => {
  if (event?.httpMethod) return { statusCode: 405, body: 'Scheduled invocation only' };
  return handler();
};
