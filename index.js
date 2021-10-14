'use strict';

const consoleColumns = require('./lib/console-columns');
const fetchAllSitemaps = require('./lib/fetch-from-sitemap');
const fs = require('fs');
const generateExcel = require('./lib/generate-excel');
const httpList = require('./lib/http-list');

/**
 * Main function that handles config, and trigger functions according to the
 * config.
 *
 * @param object config
 */
async function checkHttpStatus(config) {
  const allowedExportTypes = [
    'csv',
    'xlsx',
  ];
  var skip200 = false;
  var urlsList = [];

  if (config.skip200) {
    skip200 = true;
  }

  if (!config) {
    console.error('\x1b[31m%s\x1b[0m', 'Error: Missing required Parameters.');
    process.exit();
  } else if (!config.options) {
    config.options = {};
  }

  if (config.sitemap) {
    urlsList = await fetchAllSitemaps(config.sitemap);
  } else if (config.urls && Array.isArray(config.urls)) {
    urlsList = config.urls;
  }

  if (urlsList.length === 0) {
    console.error('\x1b[31m%s\x1b[0m', 'Error: No URL(s) found.');
    process.exit();
  } else if (config.export && !config.export.location) {
    console.error('\x1b[31m%s\x1b[0m', 'Error: Missing export location.');
    process.exit();
  } else if (config.export && !fs.existsSync(config.export.location)) {
    console.error('\x1b[31m%s\x1b[0m', 'Error: Export Location is undefined.');
    process.exit();
  }

  const httpStatusList = await httpList(urlsList, config.options, skip200);

  if (config.export && !config.export.format) {
    config.export.format = 'xlsx';
  }

  if (skip200 && httpStatusList.length === 0) {
    // Add empty line
    console.log();
    console.log('\x1b[32m%s\x1b[0m', 'All the URLs are 200 and there is nothing to worry about!');
  } else if (config.export && allowedExportTypes.includes(config.export.format)) {
    const urlLength = Math.max(...urlsList.map((el) => el.length));
    const rowLength = {
      'errorMessage': 50,
      'requestedUrl': urlLength,
      'url': urlLength + 20
    };

    generateExcel(httpStatusList, rowLength, config.export);
  } else {
    consoleColumns(httpStatusList);
  }

  // Add empty line
  console.log();
  console.log('\x1b[32m%s\x1b[0m', 'HTTP Status check completed!');
}

module.exports = checkHttpStatus;
