'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { after, before, describe, test } = require('node:test');
const { execFile } = require('child_process');
const excelJS = require('exceljs');
const checkHttpStatus = require('../index');
const startSite = require('./fixtures/site');

let site;
let tmp;

before(async () => {
  site = await startSite();
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chs-test-'));
});

after(async () => {
  await site.close();
  fs.rmSync(tmp, { 'force': true, 'recursive': true });
});

const find = (report, pathname, origin = site.origin) => report.results.find((result) => result.url === origin + pathname);

describe('crawl mode', () => {
  let report;

  before(async () => {
    report = await checkHttpStatus({
      'checkAssets': true,
      'crawl': site.origin + '/',
      'exclude': ['/docs'],
      'options': { 'timeout': 5000 },
      'silent': true,
      'sitemaps': [site.origin + '/sitemap_index.xml']
    });
  });

  test('crawls internal pages and records titles', () => {
    const tent = find(report, '/products/tents/summit-2p');
    assert.strictEqual(tent.status, 200);
    assert.strictEqual(tent.scope, 'crawl');
    assert.strictEqual(tent.crawled, true);
    assert.strictEqual(tent.title, 'Summit 2P | Acme Outdoor');
  });

  test('excluded URLs are listed and checked but not crawled', () => {
    const docs = find(report, '/docs/');
    assert.strictEqual(docs.scope, 'excluded');
    assert.strictEqual(docs.status, 200);
    assert.strictEqual(docs.crawled, false);
    assert.strictEqual(find(report, '/docs/returns'), undefined);
  });

  test('external links are checked but never crawled', () => {
    const partner = find(report, '/partners', site.externalOrigin);
    assert.strictEqual(partner.type, 'external');
    assert.strictEqual(partner.scope, 'external');
    assert.strictEqual(partner.status, 200);
    assert.strictEqual(find(report, '/should-not-be-crawled', site.externalOrigin), undefined);
    assert.strictEqual(find(report, '/deleted-article', site.externalOrigin).category, 'Not Found');
  });

  test('falls back to GET when HEAD is not allowed', () => {
    assert.strictEqual(find(report, '/head-not-allowed', site.externalOrigin).status, 200);
  });

  test('skips mailto: and #fragment links', () => {
    assert.ok(!report.results.some((result) => result.url.startsWith('mailto:') || result.url.includes('#')));
  });

  test('reports broken links with the pages and link text they were found on', () => {
    const gone = find(report, '/blog/2019/old-news');
    assert.strictEqual(gone.status, 410);
    assert.strictEqual(gone.category, 'Not Found');
    assert.deepStrictEqual(gone.foundOn.map((source) => source.page), [site.origin + '/blog/']);
    assert.deepStrictEqual(gone.foundOn[0].anchors, ['Old news']);

    const stoves = find(report, '/products/stoves');
    assert.strictEqual(stoves.category, 'Server Error');
    assert.strictEqual(stoves.foundOn.length, 2);
  });

  test('a link repeated on every page is counted once per page', () => {
    const privacy = find(report, '/privacy');
    assert.ok(privacy.foundOn.length > 10);
    assert.ok(privacy.foundOn.every((source) => source.count === 1));
  });

  test('follows redirect chains, including relative Location headers', () => {
    const bags = find(report, '/products/sleeping-bags');
    assert.strictEqual(bags.status, 301);
    assert.strictEqual(bags.redirectCount, 2);
    assert.strictEqual(bags.finalUrl, site.origin + '/collections/sleeping-bags');
    assert.strictEqual(bags.finalStatus, 404);

    const sale = find(report, '/summer-sale');
    assert.strictEqual(sale.redirectTo, site.origin + '/new-arrivals');
    assert.strictEqual(sale.finalStatus, 200);
    assert.strictEqual(find(report, '/new-arrivals').crawled, true);
  });

  test('detects redirect loops without hanging', () => {
    assert.strictEqual(find(report, '/store-locator').note, 'Redirect loop');
  });

  test('reports DNS failures as errors', () => {
    const careers = report.results.find((result) => result.url.startsWith('https://jobs.example.invalid'));
    assert.strictEqual(careers.category, 'Error');
    assert.ok(careers.error);
  });

  test('checks assets when enabled', () => {
    const image = find(report, '/images/missing-trail.jpg');
    assert.strictEqual(image.linkType, 'asset');
    assert.strictEqual(image.status, 404);
    assert.strictEqual(find(report, '/assets/style.css').status, 200);
  });

  test('reads sitemap indexes and gzipped sitemaps, and flags orphan pages', () => {
    const landing = find(report, '/unlinked-landing-page');
    assert.strictEqual(landing.inSitemap, true);
    assert.strictEqual(landing.orphan, true);
    assert.strictEqual(landing.crawled, true);
    assert.strictEqual(find(report, '/blog/deleted-post').category, 'Not Found');
    assert.strictEqual(find(report, '/about-us').orphan, false);
    assert.ok(report.summary.orphans >= 2);
  });
});

describe('crawl limits and rules', () => {
  test('maxPages stops crawling and lists the rest as not checked', async () => {
    const report = await checkHttpStatus({ 'crawl': site.origin, 'maxPages': 3, 'silent': true });
    assert.strictEqual(report.results.filter((result) => result.scope === 'crawl').length, 3);
    assert.ok(report.results.some((result) => result.scope === 'limit' && result.status === null));
    assert.strictEqual(report.summary.pageLimitReached, true);
  });

  test('onPageLimit can keep crawling past maxPages, in chunks or all at once', async () => {
    const asked = [];
    const full = await checkHttpStatus({ 'crawl': site.origin, 'silent': true });
    const fullPages = full.results.filter((result) => result.scope === 'crawl').length;

    const chunked = await checkHttpStatus({
      'crawl': site.origin,
      'maxPages': 3,
      'onPageLimit': (progress) => {
        asked.push(progress);
        return asked.length === 1;
      },
      'silent': true
    });
    assert.strictEqual(asked.length, 2);
    assert.strictEqual(asked[0].pagesCrawled, 3);
    assert.ok(asked[0].waitingPages > 0);
    assert.strictEqual(chunked.results.filter((result) => result.scope === 'crawl').length, 6);
    assert.ok(chunked.results.some((result) => result.scope === 'limit'));
    assert.strictEqual(chunked.summary.state, 'done');

    const all = await checkHttpStatus({ 'crawl': site.origin, 'maxPages': 3, 'onPageLimit': async () => Infinity, 'silent': true });
    assert.strictEqual(all.results.filter((result) => result.scope === 'crawl').length, fullPages);
    assert.ok(!all.results.some((result) => result.scope === 'limit'));
  });

  test('onPageLimit answering false, or aborting while asked, keeps the v2 result', async () => {
    const declined = await checkHttpStatus({ 'crawl': site.origin, 'maxPages': 3, 'onPageLimit': () => false, 'silent': true });
    assert.strictEqual(declined.results.filter((result) => result.scope === 'crawl').length, 3);
    assert.strictEqual(declined.summary.pageLimitReached, true);

    const controller = new AbortController();
    const aborted = await checkHttpStatus({
      'crawl': site.origin,
      'maxPages': 3,
      // Never answers: the abort has to end the crawl.
      'onPageLimit': () => {
        setTimeout(() => controller.abort(), 20);
        return new Promise(() => {});
      },
      'signal': controller.signal,
      'silent': true
    });
    assert.strictEqual(aborted.summary.state, 'stopped');
    assert.strictEqual(aborted.results.filter((result) => result.scope === 'crawl').length, 3);
  });

  test('checkExternal: false skips external links but still checks excluded pages and assets', async () => {
    const report = await checkHttpStatus({ 'checkAssets': true, 'checkExternal': false, 'crawl': site.origin, 'exclude': ['/docs'], 'silent': true });
    assert.strictEqual(find(report, '/partners', site.externalOrigin).category, 'Not checked');
    assert.strictEqual(find(report, '/docs/').status, 200);
    assert.strictEqual(find(report, '/images/missing-trail.jpg').status, 404);
  });

  test('a page only reachable through a redirect is not an orphan', async () => {
    const report = await checkHttpStatus({ 'checkExternal': false, 'crawl': site.origin, 'silent': true, 'sitemaps': [site.origin + '/sitemap_index.xml'] });
    const arrivals = find(report, '/new-arrivals');
    assert.strictEqual(arrivals.inSitemap, true);
    assert.strictEqual(arrivals.orphan, false, 'linked as /summer-sale, which redirects here');
    assert.strictEqual(find(report, '/unlinked-landing-page').orphan, true);
  });

  test('maxDepth limits how far links are followed', async () => {
    const report = await checkHttpStatus({ 'checkExternal': false, 'crawl': site.origin, 'maxDepth': 1, 'silent': true });
    assert.strictEqual(find(report, '/products/tents').crawled, true);
    assert.strictEqual(find(report, '/products/tents/summit-2p').scope, 'depth');
  });

  test('include rules restrict crawling, wildcards and regex work', async () => {
    const report = await checkHttpStatus({ 'checkExternal': false, 'crawl': site.origin, 'exclude': '/\\/basecamp-\\d+p$/', 'include': ['*/products/*'], 'silent': true });
    assert.strictEqual(find(report, '/products/tents').crawled, true);
    assert.strictEqual(find(report, '/blog/').scope, 'excluded');
    assert.strictEqual(find(report, '/products/tents/basecamp-4p').scope, 'excluded');
  });

  test('ignoreQuery merges URLs that only differ by query string', async () => {
    const report = await checkHttpStatus({ 'checkExternal': false, 'crawl': site.origin, 'ignoreQuery': true, 'silent': true });
    assert.ok(find(report, '/blog/packing-list'));
    assert.ok(!report.results.some((result) => result.url.includes('?')));
  });
});

describe('list mode', () => {
  test('checks only the given URLs and follows their redirects', async () => {
    const report = await checkHttpStatus({
      'silent': true,
      'urls': [site.origin + '/old-blog', site.origin + '/nope', site.origin + '/products/tents']
    });

    assert.strictEqual(report.summary.mode, 'list');
    assert.strictEqual(find(report, '/old-blog').finalStatus, 200);
    assert.strictEqual(find(report, '/nope').status, 404);
    assert.strictEqual(find(report, '/products/tents').crawled, false);
    assert.strictEqual(find(report, '/products/tents/summit-2p'), undefined);
  });

  test('reads URLs from sitemaps', async () => {
    const report = await checkHttpStatus({ 'silent': true, 'sitemaps': [site.origin + '/sitemap_index.xml'] });
    assert.strictEqual(find(report, '/blog/deleted-post').status, 404);
    assert.strictEqual(find(report, '/unlinked-landing-page').status, 200);
  });

  test('sends basic auth only to the checked site, plus custom headers', async () => {
    const report = await checkHttpStatus({
      'options': { 'auth': { 'password': 'secret', 'username': 'admin' }, 'headers': { 'X-Test': 'yes' } },
      'silent': true,
      'urls': [site.origin + '/staff']
    });
    assert.strictEqual(find(report, '/staff').status, 200);

    const unauthorized = await checkHttpStatus({ 'silent': true, 'urls': [site.origin + '/staff'] });
    assert.strictEqual(find(unauthorized, '/staff').status, 401);
  });

  test('bot-protection challenges are reported as Blocked, not broken, and not retried', async () => {
    const before = site.requests.length;
    const report = await checkHttpStatus({ 'retryDelay': 10, 'silent': true, 'urls': [site.origin + '/cf-protected', site.origin + '/datadome-protected', site.origin + '/plain-403'] });
    const cf = find(report, '/cf-protected');
    assert.strictEqual(cf.category, 'Blocked');
    assert.strictEqual(cf.botProtection, 'Cloudflare');
    assert.match(cf.note, /check in a browser/);
    assert.strictEqual(find(report, '/datadome-protected').botProtection, 'DataDome');
    assert.strictEqual(find(report, '/plain-403').category, 'Client Error');
    assert.strictEqual(report.summary.issues, 1, 'Blocked is not an issue');
    assert.strictEqual(site.requests.slice(before).filter((r) => r.path === '/datadome-protected').length, 2, 'HEAD + GET, no retries');
  });

  test('maxRedirects stops following long chains', async () => {
    const report = await checkHttpStatus({ 'maxRedirects': 1, 'silent': true, 'urls': [site.origin + '/products/sleeping-bags'] });
    assert.match(find(report, '/products/sleeping-bags/').note, /Stopped after 1 redirects/);
  });

  test('throws instead of exiting the process on bad input', async () => {
    await assert.rejects(checkHttpStatus({}), /Provide at least one/);
    await assert.rejects(checkHttpStatus({ 'export': { 'location': '/does/not/exist' }, 'urls': ['https://example.com'] }), /does not exist/);
  });
});

describe('exports', () => {
  test('v1 config shape still works and writes all formats', async () => {
    const report = await checkHttpStatus({
      'crawl': site.origin,
      'export': [
        { 'format': 'xlsx', 'location': tmp },
        { 'file': path.join(tmp, 'report.csv'), 'format': 'csv' },
        { 'file': path.join(tmp, 'report.json'), 'format': 'json' },
        { 'file': path.join(tmp, 'report.html'), 'format': 'html' }
      ],
      'silent': true,
      'skip200': true
    });

    const xlsxFile = fs.readdirSync(tmp).find((file) => file.startsWith('httpstatuschecker-results-') && file.endsWith('.xlsx'));
    assert.ok(xlsxFile, 'xlsx written to the export location');

    const workbook = new excelJS.Workbook();
    await workbook.xlsx.readFile(path.join(tmp, xlsxFile));
    assert.deepStrictEqual(workbook.worksheets.map((sheet) => sheet.name), ['Summary', 'URLs (non-200)', 'Issues', 'External Links']);

    const issues = workbook.getWorksheet('Issues');
    const header = issues.getRow(1).values;
    const urlCol = header.indexOf('URL');
    const foundOnCol = header.indexOf('Found On');
    const goneRow = issues.getRows(2, issues.rowCount - 1).find((row) => row.getCell(urlCol).value === site.origin + '/blog/2019/old-news');
    assert.strictEqual(goneRow.getCell(foundOnCol).value, site.origin + '/blog/');

    const csv = fs.readFileSync(path.join(tmp, 'report.csv'), 'utf8');
    assert.ok(csv.startsWith('\ufeffURL,Found On,Redirect To,Status'));
    assert.ok(!csv.includes(',OK,'), 'skip200 removes OK rows from CSV');

    const json = JSON.parse(fs.readFileSync(path.join(tmp, 'report.json'), 'utf8'));
    assert.strictEqual(json.results.length, report.results.length);

    const html = fs.readFileSync(path.join(tmp, 'report.html'), 'utf8');
    assert.ok(html.includes('/blog/2019/old-news'));
    assert.ok(!html.includes('__REPORT_DATA__'));
  });

  test('the Found On cell is capped below the Excel cell limit', () => {
    const { urlRows } = require('../lib/report/rows');
    const foundOn = Array.from({ 'length': 2000 }, (_, i) => ({ 'anchors': [], 'count': 1, 'kind': 'link', 'page': `https://example.com/a-long-page-path-number-${i}` }));
    const [row] = urlRows([{ 'category': 'OK', 'foundOn': foundOn, 'redirectChain': [], 'type': 'internal', 'url': 'https://example.com/privacy' }]);
    assert.ok(row.foundOn.length < 32767);
    assert.match(row.foundOn, /… and \d+ more \(see the JSON or HTML report\)$/);
    assert.strictEqual(row.foundOnCount, 2000);
  });

  test('HTML report escapes data so it cannot break out of the script tag', () => {
    const { renderHtml } = require('../index');
    const html = renderHtml({ 'results': [{ 'title': '</script><script>alert(1)</script>' }], 'summary': {} });
    assert.ok(!html.includes('</script><script>alert(1)'));
  });
});

describe('CLI', () => {
  const cli = path.join(__dirname, '..', 'bin', 'check-http-status.js');
  const run = (args) => new Promise((resolve) => {
    execFile(process.execPath, [cli, ...args], { 'env': { ...process.env, 'NO_COLOR': '1' } }, (error, stdout, stderr) => {
      resolve({ 'code': error ? error.code : 0, stderr, stdout });
    });
  });

  test('crawls, prints issues with their source pages, and --fail sets the exit code', async () => {
    const output = path.join(tmp, 'cli.html');
    const { code, stdout } = await run([site.origin, '-e', '/docs', '--no-external', '--fail', '-o', output]);
    assert.strictEqual(code, 1);
    assert.ok(fs.existsSync(output));
    assert.match(stdout, /410 +http:\/\/127\.0\.0\.1:\d+\/blog\/2019\/old-news/, 'issues are printed even when a report is saved');

    const printed = await run(['crawl', site.origin, '--no-external']);
    assert.match(printed.stdout, /410 +http:\/\/127\.0\.0\.1:\d+\/blog\/2019\/old-news/);
    assert.match(printed.stdout, /found on http:\/\/127\.0\.0\.1:\d+\/blog\/ \("Old news"\)/);
    assert.ok(!/^200 /m.test(printed.stdout), 'crawl lists issues only by default');
  });

  test('crawl report lists every URL with its source pages and the skipped external links', async () => {
    const output = path.join(tmp, 'cli-full.xlsx');
    await run([site.origin, '-q', '-o', output]);

    const workbook = new excelJS.Workbook();
    await workbook.xlsx.readFile(output);
    assert.deepStrictEqual(workbook.worksheets.map((sheet) => sheet.name), ['Summary', 'All URLs', 'Issues', 'External Links']);

    const rowsOf = (sheet) => {
      const header = sheet.getRow(1).values;
      return sheet.getRows(2, sheet.rowCount - 1).map((row) => Object.fromEntries(Object.entries(header).map(([i, name]) => [name, row.getCell(Number(i)).value])));
    };

    const all = rowsOf(workbook.getWorksheet('All URLs'));
    const privacy = all.find((row) => row.URL === site.origin + '/privacy');
    assert.strictEqual(privacy.Category, 'OK', '200 OK URLs are included');
    assert.ok(privacy['Found On'].includes(site.origin + '/about-us'));
    assert.ok(all.findIndex((row) => row.Type === 'external') > all.findIndex((row) => row.URL === site.origin + '/privacy'), 'internal URLs come first');

    for (const name of ['All URLs', 'Issues', 'External Links']) {
      const sheet = workbook.getWorksheet(name);
      const header = sheet.getRow(1).values.filter(Boolean);
      assert.deepStrictEqual(header.slice(0, 3), ['URL', 'Found On', 'Redirect To'], `${name} column order`);
      assert.ok(!header.includes('Link Text') && !header.includes('Found Via'));

      const urls = rowsOf(sheet).map((row) => row.URL);
      assert.strictEqual(new Set(urls).size, urls.length, `${name} lists each URL once`);
    }

    // A link found on several pages is one row, with every page in the Found On cell.
    const issues = rowsOf(workbook.getWorksheet('Issues'));
    const stoves = issues.find((row) => row.URL === site.origin + '/products/stoves');
    assert.deepStrictEqual(stoves['Found On'].split('\n').sort(), [site.origin + '/blog/packing-list?ref=blog', site.origin + '/products/']);
    assert.strictEqual(stoves['# Found On'], 2);

    const sale = issues.find((row) => row.URL === site.origin + '/summer-sale');
    assert.strictEqual(sale['Redirect To'], site.origin + '/new-arrivals');

    const external = rowsOf(workbook.getWorksheet('External Links'));
    const partner = external.find((row) => row.URL === site.externalOrigin + '/partners');
    assert.strictEqual(partner.Category, 'OK');
    assert.strictEqual(partner['Found On'], site.origin + '/about-us');
    const instagram = external.find((row) => row.URL === site.externalOrigin + '/acme-outdoor');
    assert.ok(instagram['# Found On'] > 10, 'footer link listed once with all its pages');
  });

  test('check command with --all lists 200s too', async () => {
    const { code, stdout } = await run(['check', site.origin + '/privacy', site.origin + '/nope', '--all']);
    assert.strictEqual(code, 0);
    assert.match(stdout, /^200 /m);
    assert.match(stdout, /^404 /m);
  });

  test('rejects unknown output formats', async () => {
    const { code, stderr } = await run([site.origin, '-o', 'report.pdf']);
    assert.strictEqual(code, 2);
    assert.match(stderr, /Unknown report format/);
  });
});
