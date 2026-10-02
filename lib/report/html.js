'use strict';

const fs = require('fs');
const path = require('path');

const TEMPLATE = path.join(__dirname, 'template.html');

function renderHtml(report, options = {}) {
  const template = fs.readFileSync(TEMPLATE, 'utf8');
  // Escape "<" so URLs or page titles can never close the <script> tag.
  const data = JSON.stringify(report).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  const title = (options.title || 'HTTP status report').replace(/[<>&"]/g, '');

  return template
    .replace('__TITLE__', () => title)
    .replace('__REPORT_DATA__', () => data);
}

async function writeHtml(report, file, options = {}) {
  await fs.promises.writeFile(file, renderHtml(report, options));
}

module.exports = {
  renderHtml,
  writeHtml
};
