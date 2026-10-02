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
const { login, uploadToOneDrive } = require('../lib/onedrive');

let graph;
let endpoints;
let site;
let tmp;
const sessions = new Map();
const created = [];
const links = [];
const tokenRequests = [];

// Fake Microsoft login and Graph upload API.
function startGraph() {
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) {
      chunks.push(chunk);
    }
    const body = Buffer.concat(chunks);
    const url = new URL(req.url, 'http://127.0.0.1');
    const base = `http://127.0.0.1:${server.address().port}`;
    const json = (status, data) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
    };

    const token = url.pathname.match(/^\/login\/([^/]+)\/oauth2\/v2\.0\/token$/);
    if (token) {
      const params = Object.fromEntries(new URLSearchParams(body.toString()));
      tokenRequests.push({ 'tenant': token[1], ...params });
      if (params.grant_type === 'refresh_token' && params.refresh_token.startsWith('good')) {
        return json(200, { 'access_token': 'graph-token', 'refresh_token': 'rotated-refresh' });
      } else if (params.grant_type === 'authorization_code' && params.code === 'ms-code' && params.code_verifier) {
        return json(200, { 'access_token': 'graph-token', 'refresh_token': 'first-refresh' });
      }
      return json(400, { 'error': 'invalid_grant', 'error_description': 'AADSTS70000: The refresh token has expired.\r\nTrace ID: 123' });
    }

    if (req.method === 'POST' && url.pathname.endsWith(':/createUploadSession')) {
      if (req.headers.authorization !== 'Bearer graph-token') {
        return json(401, { 'error': { 'code': 'InvalidAuthenticationToken', 'message': 'Access token is empty.' } });
      }
      const target = decodeURIComponent(url.pathname.replace('/graph', '').replace(/:\/createUploadSession$/, ''));
      if (target.includes('/Forbidden/')) {
        return json(403, { 'error': { 'code': 'accessDenied', 'message': 'Access denied' } });
      }
      const id = crypto.randomUUID();
      sessions.set(id, { 'body': [], target, 'request': JSON.parse(body.toString()) });
      return json(200, { 'uploadUrl': `${base}/upload/${id}` });
    }

    const upload = url.pathname.match(/^\/upload\/(.+)$/);
    if (upload && req.method === 'PUT') {
      const session = sessions.get(upload[1]);
      const [, start, end, total] = req.headers['content-range'].match(/^bytes (\d+)-(\d+)\/(\d+)$/).map(Number);
      assert.strictEqual(req.headers.authorization, undefined, 'upload URL must not get the bearer token');
      assert.strictEqual(body.length, end - start + 1);
      session.body.push({ 'length': body.length, start });

      if (end + 1 < total) {
        return json(202, { 'nextExpectedRanges': [`${end + 1}-`] });
      }
      const name = session.target.split('/').pop();
      const item = { 'id': 'item-' + (created.length + 1), 'name': name, 'webUrl': `https://onedrive.live.com/edit?id=${created.length + 1}` };
      created.push({ ...item, 'chunks': session.body, 'conflict': session.request.item['@microsoft.graph.conflictBehavior'], 'target': session.target, total });
      return json(201, item);
    }

    const link = url.pathname.match(/^\/graph\/me\/drive\/items\/([^/]+)\/createLink$/);
    if (link && req.method === 'POST') {
      links.push({ 'itemId': link[1], ...JSON.parse(body.toString()) });
      return json(200, { 'link': { 'type': 'view', 'webUrl': `https://1drv.ms/x/s!public-${link[1]}` } });
    }

    json(404, { 'error': { 'code': 'itemNotFound', 'message': url.pathname } });
  });

  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

before(async () => {
  graph = await startGraph();
  const base = `http://127.0.0.1:${graph.address().port}`;
  endpoints = { 'graph': `${base}/graph`, 'login': `${base}/login` };
  site = await startSite();
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chs-onedrive-'));
});

after(async () => {
  await new Promise((resolve) => graph.close(resolve));
  await site.close();
  fs.rmSync(tmp, { 'force': true, 'recursive': true });
});

describe('OneDrive upload', () => {
  test('uploads reports into the app folder', async () => {
    created.length = 0;
    const report = await checkHttpStatus({
      'export': [{ 'file': path.join(tmp, 'Site report.xlsx'), 'format': 'xlsx' }],
      'oneDrive': { 'clientId': 'app-id', endpoints, 'refreshToken': 'good-1' },
      'silent': true,
      'urls': [site.origin + '/team']
    });

    assert.strictEqual(report.uploadError, undefined);
    assert.deepStrictEqual(report.uploads.map((upload) => [upload.service, upload.name, upload.public]), [['oneDrive', 'Site report.xlsx', false]]);
    assert.strictEqual(created[0].target, '/me/drive/special/approot:/Site report.xlsx');
    assert.strictEqual(created[0].conflict, 'rename', 'never overwrites an existing report');
    assert.strictEqual(tokenRequests[tokenRequests.length - 1].tenant, 'common');
    assert.match(tokenRequests[tokenRequests.length - 1].scope, /Files\.ReadWrite\.AppFolder/);
  });

  test('uploads into a folder path and creates public view links', async () => {
    created.length = 0;
    links.length = 0;
    const file = path.join(tmp, 'audit #1.html');
    fs.writeFileSync(file, '<p>report</p>');

    const uploads = await uploadToOneDrive([{ file, 'format': 'html' }], {
      'credentials': { 'client_id': 'app-id', 'refresh_token': 'good-2', 'scope': 'offline_access Files.ReadWrite', 'tenant': 'consumers' },
      endpoints,
      'folderPath': 'Reports/SEO audits',
      'public': true
    });

    assert.strictEqual(created[0].target, '/me/drive/root:/Reports/SEO audits/audit #1.html');
    assert.deepStrictEqual(links, [{ 'itemId': created[0].id, 'scope': 'anonymous', 'type': 'view' }]);
    assert.strictEqual(uploads[0].public, true);
    assert.strictEqual(uploads[0].url, `https://1drv.ms/x/s!public-${created[0].id}`);
    assert.strictEqual(tokenRequests[tokenRequests.length - 1].tenant, 'consumers');
  });

  test('uploads large reports in 320 KiB-aligned chunks', async () => {
    created.length = 0;
    const file = path.join(tmp, 'big.json');
    fs.writeFileSync(file, Buffer.alloc(12 * 1024 * 1024, 'a'));

    await uploadToOneDrive([{ file, 'format': 'json' }], { 'clientId': 'app-id', endpoints, 'refreshToken': 'good-3' });

    const { chunks, total } = created[0];
    assert.strictEqual(total, 12 * 1024 * 1024);
    assert.ok(chunks.length > 1);
    assert.ok(chunks.slice(0, -1).every((chunk) => chunk.length % (320 * 1024) === 0));
    assert.strictEqual(chunks.reduce((sum, chunk) => sum + chunk.length, 0), total);
  });

  test('saves the rotated refresh token back to the saved login', async () => {
    const env = { ...process.env };
    process.env.XDG_CONFIG_HOME = tmp;
    process.env.APPDATA = tmp;
    delete process.env.CHS_ONEDRIVE_CREDENTIALS;
    const saved = path.join(tmp, 'check-http-status', 'onedrive-credentials.json');
    fs.mkdirSync(path.dirname(saved), { 'recursive': true });
    fs.writeFileSync(saved, JSON.stringify({ 'client_id': 'app-id', 'refresh_token': 'good-saved', 'tenant': 'common' }));

    try {
      await uploadToOneDrive([{ 'file': path.join(tmp, 'big.json'), 'format': 'json' }], { endpoints });
      assert.strictEqual(JSON.parse(fs.readFileSync(saved, 'utf8')).refresh_token, 'rotated-refresh');
    } finally {
      process.env = env;
    }
  });

  test('clear errors for expired logins and folders that need full access', async () => {
    await assert.rejects(
      uploadToOneDrive([], { 'clientId': 'app-id', endpoints, 'refreshToken': 'expired' }),
      /^Error: OneDrive: authentication failed \(AADSTS70000: The refresh token has expired\.\)\.$/
    );

    const report = await checkHttpStatus({
      'export': [{ 'file': path.join(tmp, 'x.html'), 'format': 'html' }],
      'oneDrive': { 'clientId': 'app-id', endpoints, 'folderPath': 'Forbidden/Here', 'refreshToken': 'good-4' },
      'silent': true,
      'urls': [site.origin + '/team']
    });
    assert.match(report.uploadError, /403: Access denied - uploading into your own folders needs "check-http-status onedrive-login --full-access"/);
  });

  test('fails before crawling when no credentials are configured', async () => {
    const env = { ...process.env };
    delete process.env.CHS_ONEDRIVE_CREDENTIALS;
    process.env.XDG_CONFIG_HOME = path.join(tmp, 'empty');
    process.env.APPDATA = path.join(tmp, 'empty');

    try {
      await assert.rejects(checkHttpStatus({ 'crawl': site.origin, 'oneDrive': true, 'silent': true }), /OneDrive: no credentials found/);
    } finally {
      process.env = env;
    }
  });
});

describe('onedrive-login', () => {
  test('signs in with PKCE on a localhost redirect and saves the token privately', async () => {
    const saveTo = path.join(tmp, 'login', 'onedrive.json');
    let auth;

    await login({
      'clientId': 'app-id',
      endpoints,
      'fullAccess': true,
      'log': () => {},
      'openBrowser': async (url) => {
        auth = new URL(url);
        const redirect = new URL(auth.searchParams.get('redirect_uri'));
        redirect.hostname = '127.0.0.1';
        redirect.searchParams.set('code', 'ms-code');
        redirect.searchParams.set('state', auth.searchParams.get('state'));
        await fetch(redirect);
      },
      saveTo,
      'tenant': 'organizations'
    });

    assert.strictEqual(auth.pathname, '/login/organizations/oauth2/v2.0/authorize');
    assert.strictEqual(auth.searchParams.get('scope'), 'offline_access Files.ReadWrite');
    assert.match(auth.searchParams.get('redirect_uri'), /^http:\/\/localhost:\d+$/);
    assert.strictEqual(auth.searchParams.get('code_challenge_method'), 'S256');

    const saved = JSON.parse(fs.readFileSync(saveTo, 'utf8'));
    assert.deepStrictEqual(saved, { 'client_id': 'app-id', 'refresh_token': 'first-refresh', 'scope': 'offline_access Files.ReadWrite', 'tenant': 'organizations' });
    if (process.platform !== 'win32') {
      assert.strictEqual(fs.statSync(saveTo).mode & 0o777, 0o600);
    }
  });
});
