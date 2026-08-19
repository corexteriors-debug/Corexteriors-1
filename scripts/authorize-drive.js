#!/usr/bin/env node
// One-time setup: gets a Drive refresh token for corexteriors@gmail.com via
// OAuth consent, since service accounts have no storage quota for file
// uploads (see docs/superpowers/specs/2026-08-18-labour-photo-drive-backup-design.md).
// Run manually, once — not deployed, not part of any request path.
//
// Requires GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET in the
// environment (from a Desktop-app OAuth Client created in Google Cloud
// Console for this project). Usage:
//
//   export GOOGLE_OAUTH_CLIENT_ID=...
//   export GOOGLE_OAUTH_CLIENT_SECRET=...
//   node scripts/authorize-drive.js
//
// It prints a URL — open it, sign in as corexteriors@gmail.com, and approve.
// The script then prints the refresh token to set as GOOGLE_DRIVE_REFRESH_TOKEN
// in Vercel's Production env vars.

const http = require('http');
const { google } = require('googleapis');

const PORT = 53682;
const REDIRECT_URI = `http://127.0.0.1:${PORT}`;

async function main() {
    const clientId     = (process.env.GOOGLE_OAUTH_CLIENT_ID || '').trim();
    const clientSecret = (process.env.GOOGLE_OAUTH_CLIENT_SECRET || '').trim();
    if (!clientId || !clientSecret) {
        console.error('Missing GOOGLE_OAUTH_CLIENT_ID or GOOGLE_OAUTH_CLIENT_SECRET in environment.');
        process.exit(1);
    }

    const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, REDIRECT_URI);
    const authUrl = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        prompt: 'consent', // force a refresh token even if this client was authorized before
        scope: [
            'https://www.googleapis.com/auth/drive.file',
            'https://www.googleapis.com/auth/drive.readonly',
        ],
    });

    console.log('\nOpen this URL, sign in as corexteriors@gmail.com, and approve:\n');
    console.log(authUrl);
    console.log(`\nWaiting for the redirect to ${REDIRECT_URI} ...\n`);

    const code = await new Promise((resolve, reject) => {
        const server = http.createServer((req, res) => {
            const url = new URL(req.url, REDIRECT_URI);
            const code = url.searchParams.get('code');
            const error = url.searchParams.get('error');
            if (error) {
                res.end('Authorization failed — you can close this tab.');
                server.close();
                reject(new Error(error));
                return;
            }
            if (code) {
                res.end('Authorized — you can close this tab.');
                server.close();
                resolve(code);
            }
        });
        server.listen(PORT);
    });

    const { tokens } = await oauth2Client.getToken(code);
    if (!tokens.refresh_token) {
        console.error('No refresh token returned. This account may have already granted this app access before — revoke it at https://myaccount.google.com/permissions and re-run this script.');
        process.exit(1);
    }

    console.log('\nSet this in Vercel (Production env vars):');
    console.log(`GOOGLE_DRIVE_REFRESH_TOKEN=${tokens.refresh_token}`);
}

main().catch(err => { console.error(err); process.exit(1); });
