#!/usr/bin/env node
// One-time setup: creates (or finds) the root Drive folder for labour photo
// backups and shares it with corexteriors@gmail.com. Run manually, once —
// not deployed, not part of any request path.
//
// Requires GOOGLE_SERVICE_ACCOUNT_EMAIL and GOOGLE_PRIVATE_KEY in the
// environment. These already exist in Vercel's Production env for this
// project (used by api/calendar.js). To run locally:
//
//   vercel env pull .env.drive-setup --environment=production
//   set -a; source .env.drive-setup; set +a
//   node scripts/setup-drive-folder.js
//   rm .env.drive-setup   # contains ALL project secrets — delete right after

const { google } = require('googleapis');

const ROOT_FOLDER_NAME = 'Core Exteriors – Labour Photos';
const SHARE_WITH = 'corexteriors@gmail.com';

async function main() {
    const email = (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '').trim();
    const key   = (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n').trim();
    if (!email || !key) {
        console.error('Missing GOOGLE_SERVICE_ACCOUNT_EMAIL or GOOGLE_PRIVATE_KEY in environment.');
        process.exit(1);
    }
    const auth = new google.auth.JWT({ email, key, scopes: ['https://www.googleapis.com/auth/drive.file'] });
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

    const perms = await drive.permissions.list({ fileId: folderId, fields: 'permissions(id, emailAddress, role)' });
    const alreadyShared = (perms.data.permissions || []).some(p => p.emailAddress === SHARE_WITH);
    if (alreadyShared) {
        console.log(`Already shared with ${SHARE_WITH}`);
    } else {
        await drive.permissions.create({
            fileId: folderId,
            requestBody: { type: 'user', role: 'writer', emailAddress: SHARE_WITH },
            sendNotificationEmail: true,
        });
        console.log(`Shared with ${SHARE_WITH}`);
    }

    console.log('\nSet this in Vercel (Production env vars):');
    console.log(`GOOGLE_DRIVE_ROOT_FOLDER_ID=${folderId}`);
}

main().catch(err => { console.error(err); process.exit(1); });
