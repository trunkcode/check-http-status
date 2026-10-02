'use strict';

const { externalRows, issueRows, urlRows } = require('./rows');

const HEADER_FILL = 'FF1F3A5F';
const CATEGORY_FILLS = {
  'Blocked': 'FFEDE7F6',
  'Client Error': 'FFFDE2E1',
  'Error': 'FFFBD3D0',
  'Not Found': 'FFFDE2E1',
  'OK': 'FFE6F4EA',
  'Redirect': 'FFFFF4D6',
  'Server Error': 'FFFBD3D0'
};

// Every sheet has one row per URL; all pages a URL was found on share one cell.
const URL = { 'header': 'URL', 'key': 'url', 'width': 60 };
const FOUND_ON = { 'header': 'Found On', 'key': 'foundOn', 'width': 60 };
const REDIRECT_TO = { 'header': 'Redirect To', 'key': 'redirectTo', 'width': 50 };
const STATUS = { 'header': 'Status', 'key': 'status', 'width': 22 };
const CATEGORY = { 'header': 'Category', 'key': 'category', 'width': 14 };
const FINAL_URL = { 'header': 'Final URL', 'key': 'finalUrl', 'width': 50 };
const FINAL_STATUS = { 'header': 'Final Status', 'key': 'finalStatus', 'width': 12 };
const FOUND_ON_COUNT = { 'header': '# Found On', 'key': 'foundOnCount', 'width': 11 };

const URL_COLUMNS = [
  URL,
  FOUND_ON,
  REDIRECT_TO,
  STATUS,
  CATEGORY,
  { 'header': 'Type', 'key': 'type', 'width': 10 },
  { 'header': 'Link Type', 'key': 'linkType', 'width': 10 },
  { 'header': 'Crawl', 'key': 'scope', 'width': 22 },
  { 'header': '# Redirects', 'key': 'redirectCount', 'width': 11 },
  FINAL_URL,
  FINAL_STATUS,
  { 'header': 'Title', 'key': 'title', 'width': 40 },
  { 'header': 'Content Type', 'key': 'contentType', 'width': 20 },
  { 'header': 'Depth', 'key': 'depth', 'width': 7 },
  { 'header': 'Response (ms)', 'key': 'responseTime', 'width': 13 },
  { 'header': 'In Sitemap', 'key': 'inSitemap', 'width': 10 },
  { 'header': 'Orphan', 'key': 'orphan', 'width': 8 },
  FOUND_ON_COUNT
];

const ISSUE_COLUMNS = [
  URL,
  FOUND_ON,
  REDIRECT_TO,
  STATUS,
  CATEGORY,
  { 'header': 'Type', 'key': 'type', 'width': 10 },
  FINAL_URL,
  FINAL_STATUS,
  FOUND_ON_COUNT
];

const EXTERNAL_COLUMNS = [
  URL,
  FOUND_ON,
  REDIRECT_TO,
  STATUS,
  CATEGORY,
  { 'header': 'Link Type', 'key': 'linkType', 'width': 10 },
  FINAL_URL,
  FINAL_STATUS,
  FOUND_ON_COUNT
];

function addTable(workbook, name, columns, rows) {
  const worksheet = workbook.addWorksheet(name, {
    'views': [
      {
        'state': 'frozen',
        'ySplit': 1
      }
    ]
  });

  worksheet.columns = columns;
  worksheet.getColumn('foundOn').alignment = { 'vertical': 'top', 'wrapText': true };
  worksheet.getRow(1).font = {
    'bold': true,
    'color': { 'argb': 'FFFFFFFF' }
  };
  worksheet.getRow(1).fill = {
    'fgColor': { 'argb': HEADER_FILL },
    'pattern': 'solid',
    'type': 'pattern'
  };

  for (const row of rows) {
    const added = worksheet.addRow(row);
    const fill = CATEGORY_FILLS[row.category];
    if (fill) {
      added.getCell('category').fill = {
        'fgColor': { 'argb': fill },
        'pattern': 'solid',
        'type': 'pattern'
      };
    }
  }

  if (rows.length) {
    worksheet.autoFilter = {
      'from': { 'column': 1, 'row': 1 },
      'to': { 'column': columns.length, 'row': 1 }
    };
  }

  return worksheet;
}

function addSummary(workbook, report) {
  const { summary } = report;
  const counts = summary.counts;
  const worksheet = workbook.addWorksheet('Summary');

  worksheet.columns = [{ 'width': 34 }, { 'width': 80 }];
  const lines = [
    ['Report', 'check-http-status'],
    ['Mode', summary.mode === 'crawl' ? 'Crawl website' : 'Check URL list'],
    ['Start URL(s)', summary.crawl.join('\n')],
    ['Sitemap(s)', summary.sitemaps.join('\n')],
    ['Generated', new Date(summary.finishedAt || Date.now()).toLocaleString()],
    ['Duration (s)', Math.round(summary.elapsed / 1000)],
    ['Status', summary.state],
    ['URLs found', summary.discovered],
    ['Pages crawled', summary.pagesCrawled],
    ['External links (not crawled)', report.results.filter((result) => result.type === 'external').length],
    ['Max pages reached', summary.pageLimitReached ? 'Yes - increase maxPages to crawl more' : 'No'],
    [],
    ['OK (2xx)', counts['OK'] || 0],
    ['Redirect (3xx)', counts['Redirect'] || 0],
    ['Not Found (404 / 410)', counts['Not Found'] || 0],
    ['Client Error (other 4xx)', counts['Client Error'] || 0],
    ['Server Error (5xx)', counts['Server Error'] || 0],
    ['Error (timeout / DNS / connection)', counts['Error'] || 0],
    ['Blocked by bot protection (check in a browser)', counts['Blocked'] || 0],
    ['Not checked', counts['Not checked'] || 0],
    ['Orphan pages (in sitemap, not linked)', summary.orphans],
    ['Blocked by robots.txt', summary.robotsBlocked || 0]
  ];

  if (summary.include.length || summary.exclude.length) {
    lines.push([], ['Include rules', summary.include.join('\n') || '(none)'], ['Exclude rules', summary.exclude.join('\n') || '(none)']);
  }

  lines.forEach((line) => worksheet.addRow(line));
  worksheet.getColumn(1).font = { 'bold': true };
  worksheet.getColumn(2).alignment = { 'vertical': 'top', 'wrapText': true };
}

async function writeExcel(report, file, options = {}) {
  // Loaded on demand: exceljs adds ~0.3s to startup and is only needed here.
  const excelJS = require('exceljs');
  const workbook = new excelJS.Workbook();
  workbook.creator = 'check-http-status';
  workbook.created = new Date();

  const results = options.skip200 ? report.results.filter((result) => result.category !== 'OK') : report.results;

  addSummary(workbook, report);
  addTable(workbook, options.skip200 ? 'URLs (non-200)' : 'All URLs', URL_COLUMNS, urlRows(results));
  addTable(workbook, 'Issues', ISSUE_COLUMNS, issueRows(report.results));

  const external = externalRows(report.results);
  if (external.length) {
    addTable(workbook, 'External Links', EXTERNAL_COLUMNS, external);
  }

  await workbook.xlsx.writeFile(file);
}

module.exports = writeExcel;
