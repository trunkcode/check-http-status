'use strict';

const assert = require('assert');
const { after, before, beforeEach, describe, test } = require('node:test');
const checkHttpStatus = require('../index');
const startSite = require('./fixtures/site');
const { isAllowed, parseRobots, productToken } = require('../lib/robots');

let site;

before(async () => {
  site = await startSite();
});

after(async () => {
  await site.close();
});

beforeEach(() => {
  site.state.robots = '';
  site.state.robotsStatus = null;
});

const find = (report, pathname) => report.results.find((result) => result.url === site.origin + pathname);
const allowed = (robots, path) => isAllowed(robots.rules, new URL(path, 'https://example.com'));

describe('robots.txt parsing', () => {
  test('longest match wins, Allow wins ties, * and $ work', () => {
    const robots = parseRobots([
      'User-agent: *',
      'Disallow: /private',
      'Allow: /private/press',
      'Disallow: /*.pdf$',
      'Disallow: /search?',
      'Allow: /tie',
      'Disallow: /tie'
    ].join('\n'), 'check-http-status');

    assert.strictEqual(allowed(robots, '/private/notes'), false);
    assert.strictEqual(allowed(robots, '/private/press/2026'), true);
    assert.strictEqual(allowed(robots, '/files/report.pdf'), false);
    assert.strictEqual(allowed(robots, '/files/report.pdf?x=1'), true, '$ anchors the end');
    assert.strictEqual(allowed(robots, '/search?q=tents'), false);
    assert.strictEqual(allowed(robots, '/tie'), true);
    assert.strictEqual(allowed(robots, '/public'), true);
  });

  test('a group for this crawler replaces the * group; grouped user-agent lines share rules', () => {
    const text = [
      '# comment',
      'User-agent: *',
      'Disallow: /',
      '',
      'User-agent: Googlebot',
      'User-agent: AuditBot',
      'Disallow: /admin',
      'Crawl-delay: 2'
    ].join('\n');

    const audit = parseRobots(text, 'auditbot');
    assert.strictEqual(allowed(audit, '/products'), true);
    assert.strictEqual(allowed(audit, '/admin/users'), false);
    assert.strictEqual(audit.crawlDelay, 2000);

    assert.strictEqual(allowed(parseRobots(text, 'check-http-status'), '/products'), false);
  });

  test('product token comes from the User-Agent', () => {
    assert.strictEqual(productToken(), 'check-http-status');
    assert.strictEqual(productToken('AuditBot/1.0 (+https://example.com)'), 'auditbot');
    assert.strictEqual(productToken('Mozilla/5.0 (compatible; SiteSpy/3.1; +https://x.test)'), 'sitespy');
  });
});

describe('respectRobots', () => {
  test('disallowed internal URLs are listed but never requested', async () => {
    site.state.robotsStatus = 200;
    site.state.robots = 'User-agent: *\nDisallow: /products/\nAllow: /products/$\nDisallow: /blog';

    const before = site.requests.length;
    const report = await checkHttpStatus({ 'checkExternal': false, 'crawl': site.origin, 'respectRobots': true, 'silent': true });
    const requested = site.requests.slice(before).map((request) => request.path);

    assert.strictEqual(find(report, '/products/').crawled, true, 'Allow: /products/$ keeps the listing page');
    const tents = find(report, '/products/tents');
    assert.strictEqual(tents.scope, 'robots');
    assert.strictEqual(tents.category, 'Not checked');
    assert.ok(tents.foundOn.length > 0, 'still shows where it was linked');
    assert.ok(!requested.some((p) => p.startsWith('/products/tents') || p.startsWith('/blog')), 'never requested');
    assert.strictEqual(requested.filter((p) => p === '/robots.txt').length, 1, 'robots.txt fetched once');
    assert.ok(report.summary.robotsBlocked >= 3);
  });

  test('is off by default', async () => {
    site.state.robotsStatus = 200;
    site.state.robots = 'User-agent: *\nDisallow: /';
    const report = await checkHttpStatus({ 'checkExternal': false, 'crawl': site.origin, 'silent': true });
    assert.ok(find(report, '/products/tents').crawled);
  });

  test('a 404 robots.txt allows everything; a 5xx disallows everything (RFC 9309)', async () => {
    site.state.robotsStatus = 404;
    let report = await checkHttpStatus({ 'checkExternal': false, 'crawl': site.origin, 'respectRobots': true, 'silent': true });
    assert.strictEqual(report.summary.robotsBlocked, 0);

    site.state.robotsStatus = 500;
    report = await checkHttpStatus({ 'checkExternal': false, 'crawl': site.origin, 'respectRobots': true, 'retries': 0, 'silent': true });
    assert.strictEqual(find(report, '/').scope, 'robots');
    assert.strictEqual(report.summary.pagesCrawled, 0);
  });

  test('uses the group for a custom user agent and honours Crawl-delay', async () => {
    site.state.robotsStatus = 200;
    site.state.robots = 'User-agent: *\nDisallow: /\n\nUser-agent: AuditBot\nDisallow: /blog\nCrawl-delay: 0.15';

    const before = site.requests.length;
    const report = await checkHttpStatus({ 'checkExternal': false, 'crawl': site.origin, 'maxPages': 4, 'respectRobots': true, 'silent': true, 'userAgent': 'AuditBot/2.0' });

    assert.strictEqual(find(report, '/').crawled, true);
    assert.strictEqual(find(report, '/blog/').scope, 'robots');

    const pages = site.requests.slice(before).filter((request) => request.path !== '/robots.txt').map((request) => request.time);
    for (let i = 1; i < pages.length; i++) {
      assert.ok(pages[i] - pages[i - 1] >= 140, `Crawl-delay gap ${pages[i] - pages[i - 1]}ms`);
    }
  });
});
