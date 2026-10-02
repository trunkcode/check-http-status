'use strict';

// Builds docs/demo.html and docs/sample-report.xlsx from the fixture site.
const fs = require('fs');
const os = require('os');
const path = require('path');
const checkHttpStatus = require('../index');
const startSite = require('../test/fixtures/site');
const writeExcel = require('../lib/report/excel');
const { renderHtml } = require('../lib/report/html');

const DOCS = path.join(__dirname, '..', 'docs');
const SITE = 'https://www.acme-outdoor.example';
const EXTERNAL = 'https://partner-site.example';

async function main() {
  const site = await startSite();

  try {
    const report = await checkHttpStatus({
      'checkAssets': true,
      'crawl': site.origin + '/',
      'exclude': ['/docs'],
      'silent': true,
      'sitemaps': [site.origin + '/sitemap_index.xml']
    });

    const json = JSON.stringify(report)
      .split(site.origin).join(SITE)
      .split(site.externalOrigin).join(EXTERNAL);
    const demo = JSON.parse(json);

    fs.writeFileSync(path.join(DOCS, 'demo.html'), renderHtml(demo, { 'title': 'Demo crawl report · check-http-status' }));

    // Write to a temp file first: exceljs needs a real path.
    const tmpFile = path.join(os.tmpdir(), `chs-demo-${Date.now()}.xlsx`);
    await writeExcel(demo, tmpFile);
    fs.copyFileSync(tmpFile, path.join(DOCS, 'sample-report.xlsx'));
    fs.rmSync(tmpFile);

    console.log(`Demo built: ${demo.results.length} URLs, ${demo.summary.issues} issues.`);
  } finally {
    await site.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
