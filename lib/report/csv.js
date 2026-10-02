'use strict';

const fs = require('fs');
const { urlRows } = require('./rows');

const COLUMNS = [
  ['url', 'URL'],
  ['foundOn', 'Found On'],
  ['redirectTo', 'Redirect To'],
  ['status', 'Status'],
  ['category', 'Category'],
  ['type', 'Type'],
  ['linkType', 'Link Type'],
  ['scope', 'Crawl'],
  ['redirectCount', '# Redirects'],
  ['finalUrl', 'Final URL'],
  ['finalStatus', 'Final Status'],
  ['title', 'Title'],
  ['contentType', 'Content Type'],
  ['depth', 'Depth'],
  ['responseTime', 'Response (ms)'],
  ['inSitemap', 'In Sitemap'],
  ['orphan', 'Orphan'],
  ['foundOnCount', '# Found On']
];

function cell(value) {
  const text = String(value === null || value === undefined ? '' : value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

// UTF-8 BOM so Excel detects the encoding.
async function writeCsv(report, file, options = {}) {
  const results = options.skip200 ? report.results.filter((result) => result.category !== 'OK') : report.results;
  const rows = urlRows(results);
  const lines = [COLUMNS.map(([, header]) => cell(header)).join(',')];

  for (const row of rows) {
    lines.push(COLUMNS.map(([key]) => cell(row[key])).join(','));
  }

  await fs.promises.writeFile(file, '\ufeff' + lines.join('\r\n') + '\r\n');
}

module.exports = writeCsv;
