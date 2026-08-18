#!/usr/bin/env node
// One-time setup: creates (or finds) the root Drive folder for labour photo
// backups, directly in corexteriors@gmail.com's own Drive. Run manually,
// once, after scripts/authorize-drive.js — not deployed, not part of any
// request path.
//
// Requires GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, and
// GOOGLE_DRIVE_REFRESH_TOKEN in the environment:
//
//   export GOOGLE_OAUTH_CLIENT_ID=...
//   export GOOGLE_OAUTH_CLIENT_SECRET=...
//   export GOOGLE_DRIVE_REFRESH_TOKEN=...   # from authorize-drive.js
//   node scripts/setup-drive-folder.js

const { google } = require('googleapis');

const ROOT_FOLDER_NAME = 'Core Exteriors – Labour Photos';

async function main() {
    const clientId     = (process.env.GOOGLE_OAUTH_CLIENT_ID || '').trim();
    const clientSecret = (process.env.GOOGLE_OAUTH_CLIENT_SECRET || '').trim();
    const refreshToken = (process.env.GOOGLE_DRIVE_REFRESH_TOKEN || '').trim();
    if (!clientId || !clientSecret || !refreshToken) {
        console.error('Missing GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, or GOOGLE_DRIVE_REFRESH_TOKEN in environment.');
        process.exit(1);
    }
    const auth = new google.auth.OAuth2(clientId, clientSecret);
    auth.setCredentials({ refresh_token: refreshToken });
    const drive = google.drive({ version: 'v3', auth });

    const existing = await drive.files.list({
        q: `name='${ROOT_FOLDER_NAME}' and 'root' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
        fields: 'files(id, name)',
    });

    let folderId;
    if (existing.data.files && existing.data.files.length) {
        folderId = existing.data.files[0].id;
        console.log(`Folder already exists: ${folderId}`);
    } else {
        const created = await drive.files.create({
            requestBody: { name: ROOT_FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' },
            fields: 'id',
        });
        folderId = created.data.id;
        console.log(`Created folder: ${folderId}`);
    }

    console.log('\nSet this in Vercel (Production env vars):');
    console.log(`GOOGLE_DRIVE_ROOT_FOLDER_ID=${folderId}`);
}

main().catch(err => { console.error(err); process.exit(1); });
