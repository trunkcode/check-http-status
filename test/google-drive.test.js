'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { after, before, describe, test } = require('node:test');
const checkHttpStatus = require('../index');
const startSite = require('./fixtures/site');
const { login, uploadToDrive } = require('../lib/google-drive');

const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { 'modulusLength': 2048 });
const SERVICE_ACCOUNT = {
  'client_email': 'crawler@project.iam.gserviceaccount.com',
  'private_key': privateKey.export({ 'format': 'pem', 'type': 'pkcs8' }),
  'type': 'service_account'
};

let google;
let endpoints;
let site;
let tmp;
const uploads = [];
const folders = [];
const scopes = [];
const permissions = [];

// Minimal fake of Google's OAuth token endpoint and Drive resumable upload API.
function startGoogle() {
  const sessions = new Map();

  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) {
      chunks.push(chunk);
    }
    const body = Buffer.concat(chunks);
    const url = new URL(req.url, 'http://127.0.0.1');
    const json = (status, data) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
    };

    if (url.pathname === '/token') {
      const params = new URLSearchParams(body.toString());
      const grant = params.get('grant_type');

      if (grant === 'urn:ietf:params:oauth:grant-type:jwt-bearer') {
        const [header, claims, signature] = params.get('assertion').split('.');
        const valid = crypto.createVerify('RSA-SHA256').update(`${header}.${claims}`).verify(publicKey, Buffer.from(signature, 'base64url'));
        const payload = JSON.parse(Buffer.from(claims, 'base64url').toString());
        if (!valid) {
          return json(400, { 'error': 'invalid_grant' });
        }
        scopes.push(payload.scope);
        return json(200, { 'access_token': 'sa-token' });
      } else if (grant === 'refresh_token') {
        return params.get('refresh_token') === 'good-refresh' ? json(200, { 'access_token': 'user-token' }) : json(400, { 'error': 'invalid_grant', 'error_description': 'Token has been expired or revoked.' });
      } else if (grant === 'authorization_code') {
        const verifierOk = params.get('code_verifier') && params.get('code') === 'auth-code';
        return verifierOk ? json(200, { 'access_token': 'user-token', 'refresh_token': 'new-refresh' }) : json(400, { 'error': 'invalid_grant' });
      }

      return json(400, { 'error': 'unsupported_grant_type' });
    }

    const permission = url.pathname.match(/^\/files\/([^/]+)\/permissions$/);
    if (permission && req.method === 'POST') {
      if (permission[1] === 'file-blocked') {
        return json(403, { 'error': { 'message': 'Sharing outside the domain is not allowed.' } });
      }
      permissions.push({ 'fileId': permission[1], ...JSON.parse(body.toString()) });
      return json(200, { 'id': 'anyoneWithLink' });
    }

    if (url.pathname === '/files' && req.method === 'GET') {
      const name = url.searchParams.get('q').match(/^name = '(.*)' and mimeType/)[1];
      return json(200, { 'files': folders.filter((folder) => folder.name === name) });
    } else if (url.pathname === '/files' && req.method === 'POST') {
      const folder = { ...JSON.parse(body.toString()), 'id': 'folder-' + (folders.length + 1) };
      folders.push(folder);
      return json(200, { 'id': folder.id });
    }

    if (url.pathname === '/upload' && req.method === 'POST') {
      if (!['Bearer sa-token', 'Bearer user-token'].includes(req.headers.authorization)) {
        return json(401, { 'error': { 'message': 'Invalid Credentials' } });
      }

      const metadata = JSON.parse(body.toString());
      if (metadata.parents && metadata.parents[0] === 'missing-folder') {
        return json(404, { 'error': { 'message': 'File not found: missing-folder.' } });
      }

      const id = crypto.randomUUID();
      sessions.set(id, { 'contentType': req.headers['x-upload-content-type'], metadata, 'query': url.search });
      res.writeHead(200, { 'Location': `http://127.0.0.1:${server.address().port}/session/${id}` });
      return res.end();
    }

    if (url.pathname.startsWith('/session/') && req.method === 'PUT') {
      const session = sessions.get(url.pathname.split('/').pop());
      const id = session.metadata.name.includes('blocked') ? 'file-blocked' : 'file-' + (uploads.length + 1);
      uploads.push({ ...session, 'size': body.length, 'starts': body.subarray(0, 2).toString() });
      return json(200, { id, 'mimeType': session.metadata.mimeType || session.contentType, 'name': session.metadata.name, 'webViewLink': `https://drive.google.com/file/d/${id}/view` });
    }

    json(404, {});
  });

  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

before(async () => {
  google = await startGoogle();
  const base = `http://127.0.0.1:${google.address().port}`;
  endpoints = { 'auth': `${base}/auth`, 'files': `${base}/files`, 'token': `${base}/token`, 'upload': `${base}/upload` };
  site = await startSite();
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chs-drive-'));
});

after(async () => {
  await new Promise((resolve) => google.close(resolve));
  await site.close();
  fs.rmSync(tmp, { 'force': true, 'recursive': true });
});

describe('Google Drive upload', () => {
  test('uploads with a service account and converts spreadsheets to Google Sheets', async () => {
    uploads.length = 0;
    const report = await checkHttpStatus({
      'crawl': site.origin,
      'export': [
        { 'file': path.join(tmp, 'Acme report.xlsx'), 'format': 'xlsx' },
        { 'file': path.join(tmp, 'Acme report.html'), 'format': 'html' }
      ],
      'googleDrive': { 'credentials': SERVICE_ACCOUNT, endpoints, 'folderId': 'folder-123' },
      'silent': true
    });

    assert.strictEqual(report.uploadError, undefined);
    assert.strictEqual(report.uploads.length, 2);
    assert.strictEqual(report.uploads[0].name, 'Acme report');
    assert.strictEqual(report.uploads[0].mimeType, 'application/vnd.google-apps.spreadsheet');
    assert.match(report.uploads[0].url, /^https:\/\/drive\.google\.com\//);

    const [sheet, html] = uploads;
    assert.deepStrictEqual(sheet.metadata.parents, ['folder-123']);
    assert.strictEqual(sheet.contentType, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    assert.strictEqual(sheet.starts, 'PK', 'uploads the real .xlsx bytes');
    assert.match(sheet.query, /supportsAllDrives=true/);
    assert.strictEqual(html.metadata.name, 'Acme report.html');
    assert.strictEqual(html.metadata.mimeType, undefined, 'HTML is uploaded as a file');
    assert.strictEqual(scopes.pop(), 'https://www.googleapis.com/auth/drive', 'a chosen folder needs full scope');
  });

  test('without a folder ID, uploads into its own report folder, created once and reused', async () => {
    uploads.length = 0;
    folders.length = 0;
    const options = { 'credentials': SERVICE_ACCOUNT, endpoints };

    await uploadToDrive([{ 'file': path.join(tmp, 'Acme report.html'), 'format': 'html' }], options);
    await uploadToDrive([{ 'file': path.join(tmp, 'Acme report.html'), 'format': 'html' }], options);

    assert.deepStrictEqual(folders.map((folder) => [folder.name, folder.mimeType]), [['HTTP Status Reports', 'application/vnd.google-apps.folder']]);
    assert.deepStrictEqual(uploads.map((upload) => upload.metadata.parents[0]), ['folder-1', 'folder-1']);
    assert.strictEqual(scopes.pop(), 'https://www.googleapis.com/auth/drive.file', 'own folder only needs drive.file');

    await uploadToDrive([{ 'file': path.join(tmp, 'Acme report.html'), 'format': 'html' }], { ...options, 'folderName': "Client's audits" });
    assert.strictEqual(folders[1].name, "Client's audits");
  });

  test('without an export, creates an Excel report, uploads it and removes the temp file', async () => {
    uploads.length = 0;
    const report = await checkHttpStatus({
      'crawl': site.origin,
      'googleDrive': { 'clientId': 'id', 'clientSecret': 'secret', 'convert': false, endpoints, 'refreshToken': 'good-refresh' },
      'silent': true
    });

    assert.strictEqual(report.uploads.length, 1);
    assert.match(report.uploads[0].name, /^HTTP status - 127\.0\.0\.1 - .+\.xlsx$/);
    assert.ok(!fs.existsSync(path.join(os.tmpdir(), report.uploads[0].name)), 'temp file removed');
  });

  test('upload failures are reported without losing the crawl results', async () => {
    const report = await checkHttpStatus({
      'crawl': site.origin,
      'export': { 'file': path.join(tmp, 'kept.xlsx'), 'format': 'xlsx' },
      'googleDrive': { 'credentials': SERVICE_ACCOUNT, endpoints, 'folderId': 'missing-folder' },
      'silent': true
    });

    assert.ok(report.results.length > 10);
    assert.match(report.uploadError, /404: File not found.*check the folder ID/);
    assert.ok(fs.existsSync(path.join(tmp, 'kept.xlsx')), 'local report kept');
  });

  test('expired refresh tokens give a clear error', async () => {
    await assert.rejects(
      uploadToDrive([], { 'credentials': { 'client_id': 'id', 'refresh_token': 'revoked', 'type': 'authorized_user' }, endpoints }),
      /authentication failed \(Token has been expired or revoked\.\)/
    );
  });

  test('fails before crawling when no credentials are configured', async () => {
    const env = { ...process.env };
    delete process.env.CHS_GOOGLE_CREDENTIALS;
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    process.env.XDG_CONFIG_HOME = tmp;
    process.env.APPDATA = tmp;

    try {
      await assert.rejects(checkHttpStatus({ 'crawl': site.origin, 'googleDrive': true, 'silent': true }), /no credentials found/);
    } finally {
      process.env = env;
    }
  });

  test('credentials can come from CHS_GOOGLE_CREDENTIALS', async () => {
    const env = { ...process.env };
    process.env.CHS_GOOGLE_CREDENTIALS = JSON.stringify(SERVICE_ACCOUNT);

    try {
      const report = await checkHttpStatus({ 'googleDrive': { endpoints }, 'silent': true, 'urls': [site.origin + '/privacy'] });
      assert.strictEqual(report.uploads.length, 1);
    } finally {
      process.env = env;
    }
  });
});

describe('drive-login', () => {
  test('completes the browser OAuth flow (PKCE) and saves the refresh token privately', async () => {
    const saveTo = path.join(tmp, 'login', 'google-credentials.json');
    let authUrl;

    const file = await login({
      'clientId': 'desktop-client',
      'clientSecret': 'shh',
      endpoints,
      'log': () => {},
      // Stand in for the user's browser: Google redirects back with a code.
      'openBrowser': async (url) => {
        authUrl = new URL(url);
        const redirect = new URL(authUrl.searchParams.get('redirect_uri'));
        redirect.searchParams.set('code', 'auth-code');
        redirect.searchParams.set('state', authUrl.searchParams.get('state'));
        await fetch(redirect);
      },
      saveTo
    });

    assert.strictEqual(file, saveTo);
    assert.strictEqual(authUrl.searchParams.get('scope'), 'https://www.googleapis.com/auth/drive.file');
    assert.strictEqual(authUrl.searchParams.get('code_challenge_method'), 'S256');
    assert.match(authUrl.searchParams.get('redirect_uri'), /^http:\/\/127\.0\.0\.1:\d+$/);

    const saved = JSON.parse(fs.readFileSync(saveTo, 'utf8'));
    assert.deepStrictEqual(saved, { 'client_id': 'desktop-client', 'client_secret': 'shh', 'refresh_token': 'new-refresh', 'type': 'authorized_user' });
    if (process.platform !== 'win32') {
      assert.strictEqual(fs.statSync(saveTo).mode & 0o777, 0o600);
    }
  });

  test('rejects a redirect with the wrong state', async () => {
    await assert.rejects(login({
      'clientId': 'desktop-client',
      endpoints,
      'log': () => {},
      'openBrowser': async (url) => {
        const redirect = new URL(new URL(url).searchParams.get('redirect_uri'));
        redirect.searchParams.set('code', 'auth-code');
        redirect.searchParams.set('state', 'forged');
        await fetch(redirect);
      },
      'saveTo': path.join(tmp, 'never.json')
    }), /login failed/);
  });
});

describe('drive-login --full-access', () => {
  test('requests the full Drive scope', async () => {
    let scope;
    await login({
      'clientId': 'desktop-client',
      endpoints,
      'fullAccess': true,
      'log': () => {},
      'openBrowser': async (url) => {
        const auth = new URL(url);
        scope = auth.searchParams.get('scope');
        const redirect = new URL(auth.searchParams.get('redirect_uri'));
        redirect.searchParams.set('code', 'auth-code');
        redirect.searchParams.set('state', auth.searchParams.get('state'));
        await fetch(redirect);
      },
      'saveTo': path.join(tmp, 'full', 'creds.json')
    });

    assert.strictEqual(scope, 'https://www.googleapis.com/auth/drive');
  });
});

describe('Google Drive public sharing', () => {
  test('public: true lets anyone with the link view each uploaded file', async () => {
    uploads.length = 0;
    permissions.length = 0;
    const report = await checkHttpStatus({
      'export': [{ 'file': path.join(tmp, 'public.xlsx'), 'format': 'xlsx' }, { 'file': path.join(tmp, 'public.html'), 'format': 'html' }],
      'googleDrive': { 'credentials': SERVICE_ACCOUNT, endpoints, 'public': true },
      'silent': true,
      'urls': [site.origin + '/privacy']
    });

    assert.strictEqual(report.uploadError, undefined);
    assert.ok(report.uploads.every((upload) => upload.public === true && upload.service === 'googleDrive'));
    assert.deepStrictEqual(permissions.map((p) => [p.fileId, p.role, p.type]), report.uploads.map((upload) => [upload.id, 'reader', 'anyone']));
  });

  test('explains when the organization blocks public sharing', async () => {
    const file = path.join(tmp, 'blocked.html');
    fs.writeFileSync(file, '<p>report</p>');

    await assert.rejects(
      uploadToDrive([{ file, 'format': 'html' }], { 'credentials': SERVICE_ACCOUNT, endpoints, 'public': true }),
      /uploaded blocked\.html but could not make it public \(403: Sharing outside the domain is not allowed\. - your Google Workspace admin may block/
    );
  });
});
