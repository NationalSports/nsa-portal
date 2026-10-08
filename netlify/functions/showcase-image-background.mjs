import { withLambda } from '@netlify/aws-lambda-compat';
// The v2 dependency tracer misses packages required only through the legacy
// CommonJS worker. Anchor this dependency so the deployed bundle can boot.
import '@supabase/supabase-js';
import worker from './_background-workers/showcase-image-background.js';

// Preserve the existing worker on Netlify's runtime without Lambda's 4 KB env limit.
export default withLambda(worker.handler);
export const config = { background: true };
