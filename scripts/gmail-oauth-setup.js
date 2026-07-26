#!/usr/bin/env node
/* eslint-disable no-console */
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');

const credentialsPath = process.argv[2] || process.env.GMAIL_OAUTH_CREDENTIALS;
let downloadedCredentials = {};

if (credentialsPath) {
  try {
    const credentialFile = JSON.parse(fs.readFileSync(credentialsPath, 'utf8'));
    downloadedCredentials = credentialFile.installed || credentialFile.web || {};
  } catch (error) {
    console.error(`Could not read Google OAuth JSON: ${error.message}`);
    process.exit(1);
  }
}

const clientId = process.env.GMAIL_CLIENT_ID || downloadedCredentials.client_id;
const clientSecret = process.env.GMAIL_CLIENT_SECRET || downloadedCredentials.client_secret;
const port = Number(process.env.GMAIL_OAUTH_PORT || 53682);
const redirectUri = `http://127.0.0.1:${port}/oauth2callback`;
const scopes = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.compose',
];

if (!clientId || !clientSecret) {
  console.error(
    'Pass the downloaded Google OAuth JSON file, or set GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET.'
  );
  console.error('Example: node scripts/gmail-oauth-setup.js ~/Downloads/client_secret_....json');
  process.exit(1);
}

const state = crypto.randomBytes(24).toString('hex');
const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
authUrl.search = new URLSearchParams({
  client_id: clientId,
  redirect_uri: redirectUri,
  response_type: 'code',
  access_type: 'offline',
  prompt: 'consent',
  scope: scopes.join(' '),
  state,
}).toString();

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, redirectUri);
  if (url.pathname !== '/oauth2callback') {
    res.writeHead(404).end('Not found');
    return;
  }
  if (url.searchParams.get('state') !== state) {
    res.writeHead(400).end('Invalid OAuth state');
    return;
  }
  const code = url.searchParams.get('code');
  if (!code) {
    res.writeHead(400).end(`Google did not return a code: ${url.searchParams.get('error') || 'unknown error'}`);
    return;
  }
  try {
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
      }),
    });
    const tokens = await tokenResponse.json();
    if (!tokenResponse.ok || !tokens.refresh_token) {
      throw new Error(tokens.error_description || tokens.error || 'No refresh token returned');
    }
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('NSA Portal Gmail authorization complete. Return to the terminal.');
    const outputPath = path.join(__dirname, '.env');
    const syncSecret = crypto.randomBytes(32).toString('hex');
    const envFile = [
      `GMAIL_CLIENT_ID=${clientId}`,
      `GMAIL_CLIENT_SECRET=${clientSecret}`,
      `GMAIL_REFRESH_TOKEN=${tokens.refresh_token}`,
      'GMAIL_AI_INBOX=sales@nationalsportsapparel.com',
      `GMAIL_AI_SYNC_SECRET=${syncSecret}`,
      '',
    ].join('\n');
    fs.writeFileSync(outputPath, envFile, { mode: 0o600 });
    fs.chmodSync(outputPath, 0o600);
    console.log(`\nCredentials saved securely to ${outputPath}`);
    console.log('This file is ignored by Git. Do not upload or share it.');
  } catch (error) {
    res.writeHead(500).end('Token exchange failed. See the terminal.');
    console.error(error.message);
  } finally {
    setTimeout(() => server.close(), 100);
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log('Authorize while signed into sales@nationalsportsapparel.com:\n');
  console.log(authUrl.toString());
  console.log(`\nWaiting for Google on ${redirectUri}`);
});
