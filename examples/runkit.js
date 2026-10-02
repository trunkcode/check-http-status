'use strict';

const checkHttpStatus = require('check-http-status');

// Crawl a site, skip /docs (still listed), and print the broken links with the pages they were found on.
checkHttpStatus({
  'crawl': 'https://www.trunkcode.com/',
  'exclude': ['/docs'],
  'maxPages': 50,
  'silent': true
}).then((report) => {
  console.log(report.summary.counts);

  for (const result of report.results) {
    if (['Not Found', 'Client Error', 'Server Error', 'Error'].includes(result.category)) {
      console.log(result.status || result.error, result.url, 'found on', result.foundOn.map((source) => source.page));
    }
  }
});
