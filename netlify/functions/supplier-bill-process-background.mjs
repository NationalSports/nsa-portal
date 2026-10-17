import { withLambda } from '@netlify/aws-lambda-compat';
import worker from './_background-workers/supplier-bill-process-background.js';

export default withLambda(worker.handler);
export const config = { background: true };
