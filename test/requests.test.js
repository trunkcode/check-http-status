'use strict';

const assert = require('assert');
const path = require('path');
const { after, before, describe, test } = require('node:test');
const { execFile } = require('child_process');
const checkHttpStatus = require('../index');
const startSite = require('./fixtures/site');
const { recheck } = require('../index');

let site;

before(async () => {
  site = await startSite();
});

after(async () => {
  await site.close();
});

const find = (report, pathname) => report.results.find((result) => result.url === site.origin + pathname);

describe('retries and rate limiting', () => {
  test('retries temporary 503s and succeeds', async () => {
    const report = await checkHttpStatus({ 'retryDelay': 10, 'silent': true, 'urls': [site.origin + '/flaky/2'] });
    assert.strictEqual(find(report, '/flaky/2').status, 200);
  });

  test('reports the last status when retries run out', async () => {
    const report = await checkHttpStatus({ 'retries': 0, 'silent': true, 'urls': [site.origin + '/flaky/5'] });
    assert.strictEqual(find(report, '/flaky/5').status, 503);

    const limited = await checkHttpStatus({ 'retries': 2, 'retryDelay': 10, 'silent': true, 'urls': [site.origin + '/always-429'] });
    assert.strictEqual(find(limited, '/always-429').status, 429);
    // HEAD (1 + 2 retries) then the GET fallback (1 + 2 retries).
    assert.strictEqual(site.requests.filter((request) => request.path === '/always-429').length, 6);
  });

  test('does not retry 404s', async () => {
    const before = site.requests.length;
    await checkHttpStatus({ 'retryDelay': 10, 'silent': true, 'urls': [site.origin + '/no-such-page'] });
    assert.strictEqual(site.requests.slice(before).length, 2, 'one HEAD and one GET');
  });

  test('delay spaces out requests to the same site', async () => {
    const urls = ['/team', '/privacy', '/size-guide'].map((pathname) => site.origin + pathname);
    const before = site.requests.length;
    const startedAt = Date.now();
    await checkHttpStatus({ 'concurrency': 5, 'delay': 150, 'silent': true, urls });

    // Request n starts no earlier than n × delay (arrival gaps vary with connection warm-up).
    const times = site.requests.slice(before).map((request) => request.time - startedAt);
    assert.strictEqual(times.length, 3);
    times.forEach((time, i) => assert.ok(time >= i * 150 - 10, `request ${i} at ${time}ms`));
  });

  test('custom user agent', async () => {
    const before = site.requests.length;
    await checkHttpStatus({ 'silent': true, 'urls': [site.origin + '/team'], 'userAgent': 'AuditBot/1.0' });
    assert.ok(site.requests.slice(before).every((request) => request.userAgent === 'AuditBot/1.0'));

    await checkHttpStatus({ 'silent': true, 'urls': [site.origin + '/team'] });
    assert.match(site.requests[site.requests.length - 1].userAgent, /check-http-status\/2/);
  });
});

describe('library controls', () => {
  test('an AbortSignal stops the crawl quickly and keeps what was checked', async () => {
    const controller = new AbortController();
    const startedAt = Date.now();
    setTimeout(() => controller.abort(), 200);

    const report = await checkHttpStatus({ 'signal': controller.signal, 'silent': true, 'urls': [site.origin + '/slow', site.origin + '/team'] });

    assert.ok(Date.now() - startedAt < 2000, 'did not wait for the 3s response');
    assert.strictEqual(report.summary.state, 'stopped');
    assert.strictEqual(find(report, '/slow').category, 'Not checked');
    assert.strictEqual(find(report, '/slow').error, '');
    assert.strictEqual(find(report, '/team').status, 200);
  });

  test('an already-aborted signal returns at once', async () => {
    const report = await checkHttpStatus({ 'crawl': site.origin, 'signal': AbortSignal.abort(), 'silent': true });
    assert.strictEqual(report.summary.state, 'stopped');
    assert.strictEqual(report.summary.checked, 0);
  });

  test('onResult streams each URL as soon as it is checked', async () => {
    const streamed = [];
    const report = await checkHttpStatus({ 'checkExternal': false, 'crawl': site.origin, 'onResult': (result) => streamed.push(result), 'silent': true });

    assert.strictEqual(streamed.length, report.summary.checked);
    assert.ok(streamed.every((result) => result.url && result.category && Array.isArray(result.foundOn)));
    assert.strictEqual(streamed[0].url, site.origin + '/', 'start page first');
  });

  test('recheck updates fixed URLs but keeps where they were found', async () => {
    site.state.fixed = false;
    const report = await checkHttpStatus({ 'silent': true, 'urls': [site.origin + '/toggle', site.origin + '/team'] });
    // Pretend the crawl found /toggle on two pages.
    const toggle = find(report, '/toggle');
    toggle.foundOn = [{ 'anchors': ['Toggle'], 'count': 1, 'kind': 'link', 'page': site.origin + '/' }, { 'anchors': [], 'count': 1, 'kind': 'link', 'page': site.origin + '/team' }];
    assert.strictEqual(toggle.category, 'Not Found');
    assert.strictEqual(report.summary.counts['Not Found'], 1);

    site.state.fixed = true;
    const updated = await recheck(report, [site.origin + '/toggle']);

    const fixed = find(updated, '/toggle');
    assert.strictEqual(fixed.status, 200);
    assert.strictEqual(fixed.category, 'OK');
    assert.strictEqual(fixed.rechecked, true);
    assert.strictEqual(fixed.foundOn.length, 2, 'found-on pages kept');
    assert.strictEqual(updated.summary.counts['Not Found'], undefined);
    assert.strictEqual(updated.summary.issues, 0);
    assert.strictEqual(find(report, '/toggle').status, 404, 'original report untouched');
  });

  test('recheck adds new redirect targets', async () => {
    const report = await checkHttpStatus({ 'silent': true, 'urls': [site.origin + '/team'] });
    const updated = await recheck(report, [site.origin + '/old-blog']);
    assert.strictEqual(find(updated, '/old-blog').redirectTo, site.origin + '/blog/');
    assert.strictEqual(find(updated, '/blog/').status, 200);
  });
});

describe('CLI cloud flags', () => {
  test('--public needs a cloud service', async () => {
    const cli = path.join(__dirname, '..', 'bin', 'check-http-status.js');
    const { code, stderr } = await new Promise((resolve) => {
      execFile(process.execPath, [cli, site.origin, '--public'], (error, stdout, err) => resolve({ 'code': error ? error.code : 0, 'stderr': err }));
    });
    assert.strictEqual(code, 2);
    assert.match(stderr, /--public needs --drive and\/or --onedrive/);
  });
});
