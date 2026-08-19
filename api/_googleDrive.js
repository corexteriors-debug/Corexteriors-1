const { kv } = require('@vercel/kv');
const { put } = require('@vercel/blob');
const { google } = require('googleapis');
const { Readable } = require('stream');

const TAG_FOLDER_NAMES = { before: 'Before', after: 'After' };

// Service accounts have no Drive storage quota for file bytes (Google's 2022
// policy change — confirmed by a live 403 storageQuotaExceeded when this used
// google.auth.JWT). Uploads instead go through OAuth delegation: a one-time
// consent from corexteriors@gmail.com (scripts/authorize-drive.js) produced a
// refresh token, so uploads use that account's own quota.
function buildDriveClient() {
    const clientId     = (process.env.GOOGLE_OAUTH_CLIENT_ID || '').trim();
    const clientSecret = (process.env.GOOGLE_OAUTH_CLIENT_SECRET || '').trim();
    const refreshToken  = (process.env.GOOGLE_DRIVE_REFRESH_TOKEN || '').trim();
    if (!clientId || !clientSecret || !refreshToken) {
        console.warn('Drive backup: missing GOOGLE_OAUTH_CLIENT_ID/GOOGLE_OAUTH_CLIENT_SECRET/GOOGLE_DRIVE_REFRESH_TOKEN, skipping');
        return null;
    }
    const auth = new google.auth.OAuth2(clientId, clientSecret);
    auth.setCredentials({ refresh_token: refreshToken });
    return google.drive({ version: 'v3', auth });
}

function escapeDriveName(name) {
    return String(name).replace(/'/g, "\\'");
}

async function findOrCreateFolder(drive, name, parentId) {
    const q = `name='${escapeDriveName(name)}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`;
    const list = await drive.files.list({ q, fields: 'files(id)', spaces: 'drive' });
    if (list.data.files && list.data.files.length) return list.data.files[0].id;
    const created = await drive.files.create({
        requestBody: { name, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] },
        fields: 'id',
    });
    return created.data.id;
}

// Resolves (creating + KV-caching as needed) the {date}/{jobTitle}/{Before|After|Other}
// folder chain under the fixed root folder, then uploads the photo into it.
// Never throws — any failure is logged and swallowed so a Drive outage can never
// break a worker's photo upload. See docs/superpowers/specs/2026-08-18-labour-photo-drive-backup-design.md.
async function backupPhotoToDrive({ date, jobId, jobTitle, tag, workerName, buffer, mimeType, fileExt }) {
    try {
        const rootId = (process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID || '').trim();
        if (!rootId) { console.warn('Drive backup: missing GOOGLE_DRIVE_ROOT_FOLDER_ID, skipping'); return; }
        const drive = buildDriveClient();
        if (!drive) return;

        const tagKey  = (tag === 'before' || tag === 'after') ? tag : 'other';
        const tagName = TAG_FOLDER_NAMES[tagKey] || 'Other';

        const dateCacheKey = `drive-folder:${date}`;
        let dateFolderId = await kv.get(dateCacheKey);
        if (!dateFolderId) {
            dateFolderId = await findOrCreateFolder(drive, date, rootId);
            await kv.set(dateCacheKey, dateFolderId);
        }

        const jobCacheKey = `drive-folder:${date}:${jobId}`;
        let jobFolderId = await kv.get(jobCacheKey);
        if (!jobFolderId) {
            jobFolderId = await findOrCreateFolder(drive, jobTitle || 'Job', dateFolderId);
            await kv.set(jobCacheKey, jobFolderId);
        }

        const tagCacheKey = `drive-folder:${date}:${jobId}:${tagKey}`;
        let tagFolderId = await kv.get(tagCacheKey);
        if (!tagFolderId) {
            tagFolderId = await findOrCreateFolder(drive, tagName, jobFolderId);
            await kv.set(tagCacheKey, tagFolderId);
        }

        const time = new Date().toLocaleTimeString('en-CA', { timeZone: 'America/Toronto', hour12: false }).replace(/:/g, '');
        const safeName = (workerName || 'worker').replace(/[\\/'"]/g, '');
        const fileName = `${safeName}-${time}.${fileExt}`;

        await drive.files.create({
            requestBody: { name: fileName, parents: [tagFolderId] },
            media: { mimeType, body: Readable.from(buffer) },
            fields: 'id',
        });
    } catch (err) {
        console.error('Drive backup failed:', err.message);
    }
}

// Mirrors a Calendar-attached Drive file (which our OAuth-delegated account
// didn't create, hence needs drive.readonly, not just drive.file) into Vercel
// Blob so it can be shown to PIN-authenticated workers as a normal image URL.
// Cached forever in KV by fileId — a manager re-attaching a different image
// gets a new fileId from Calendar, so this never serves stale content.
// Never throws — see docs/superpowers/specs/2026-08-18-calendar-attachment-images-design.md.
async function mirrorAttachmentToBlob({ fileId, mimeType, fileName }) {
    try {
        const cacheKey = `calendar-attachment-blob:${fileId}`;
        const cached = await kv.get(cacheKey);
        if (cached) return cached;

        const drive = buildDriveClient();
        if (!drive) return null;

        const res = await drive.files.get({ fileId, alt: 'media' }, { responseType: 'arraybuffer' });
        const buffer = Buffer.from(res.data);

        const blob = await put(`calendar-attachments/${fileId}-${fileName || 'image'}`, buffer, {
            access: 'public', contentType: mimeType, addRandomSuffix: true,
        });

        await kv.set(cacheKey, blob.url);
        return blob.url;
    } catch (err) {
        console.error('Calendar attachment mirror failed:', err.message);
        return null;
    }
}

module.exports = { backupPhotoToDrive, mirrorAttachmentToBlob };
