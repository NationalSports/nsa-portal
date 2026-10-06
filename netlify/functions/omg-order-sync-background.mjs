import { withLambda } from '@netlify/aws-lambda-compat';
import worker from './_omg-order-sync-background.js';

// Preserve the existing worker on Netlify's runtime without Lambda's 4 KB env limit.
export default withLambda(worker.handler);
export const config = { background: true };
