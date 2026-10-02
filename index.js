'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const fetchSitemaps = require('./lib/sitemaps');
const googleDrive = require('./lib/google-drive');
const oneDrive = require('./lib/onedrive');
const writeCsv = require('./lib/report/csv');
const writeExcel = require('./lib/report/excel');
const { Checker, ISSUE_CATEGORIES, categorize } = require('./lib/checker');
const { createProgressPrinter, printReport } = require('./lib/report/console');
const { createRequester } = require('./lib/request');
const { createRobots } = require('./lib/robots');
const { findConfig, loadConfig } = require('./lib/config');
const { renderHtml, writeHtml } = require('./lib/report/html');

const EXPORT_FORMATS = ['xlsx', 'csv', 'json', 'html'];
const CLOUD_SERVICES = {
  'googleDrive': { 'label': 'Google Drive', 'resolveCredentials': googleDrive.resolveCredentials, 'upload': googleDrive.uploadToDrive },
  'oneDrive': { 'label': 'OneDrive', 'resolveCredentials': oneDrive.resolveCredentials, 'upload': oneDrive.uploadToOneDrive }
};
// Fields `recheck()` refreshes; where a URL was found stays as crawled.
const STATUS_FIELDS = ['category', 'contentType', 'error', 'finalStatus', 'finalUrl', 'note', 'redirectChain', 'redirectCount', 'redirectTo', 'responseTime', 'status', 'statusText'];

const toArray = (value) => {
  if (value === undefined || value === null || value === '') {
    return [];
  }

  return Array.isArray(value) ? value : [value];
};

const toInt = (value, fallback, min, max) => {
  const number = parseInt(value, 10);
  return Number.isNaN(number) ? fallback : Math.min(max, Math.max(min, number));
};

function normalizeUrl(url) {
  let value = String(url).trim();
  if (!/^https?:\/\//i.test(value)) {
    value = 'https://' + value;
  }

  try {
    return new URL(value).href;
  } catch {
    throw new Error(`Invalid URL: ${url}`);
  }
}

function normalizeConfig(config) {
  if (!config || typeof config !== 'object') {
    throw new Error('Missing required parameters.');
  }

  const options = config.options || {};
  const rules = (value) => toArray(value).flatMap((rule) => String(rule).split(/\r?\n/)).map((rule) => rule.trim()).filter(Boolean);
  const normalized = {
    'checkAssets': !!config.checkAssets,
    'checkExternal': config.checkExternal !== false,
    'concurrency': toInt(config.concurrency, 10, 1, 100),
    // Only filters the terminal output; saved reports keep every URL.
    'consoleIssuesOnly': !!config.consoleIssuesOnly,
    'crawl': toArray(config.crawl).map(normalizeUrl),
    'exclude': rules(config.exclude),
    'ignoreQuery': !!config.ignoreQuery,
    'include': rules(config.include),
    'maxDepth': config.maxDepth === undefined || config.maxDepth === null || config.maxDepth === '' ? null : toInt(config.maxDepth, null, 0, 10000),
    'maxPages': toInt(config.maxPages, 1000, 1, 1000000),
    'maxRedirects': toInt(config.maxRedirects, 10, 0, 50),
    'onProgress': typeof config.onProgress === 'function' ? config.onProgress : null,
    'onResult': typeof config.onResult === 'function' ? config.onResult : null,
    // CLI: print the URL list even when reports are saved.
    'printResults': !!config.printResults,
    'respectRobots': !!config.respectRobots,
    'options': {
      'auth': options.auth,
      'delay': toInt(config.delay, 0, 0, 600000),
      'headers': options.headers,
      'retries': toInt(config.retries, 2, 0, 10),
      'retryDelay': toInt(config.retryDelay, 1000, 0, 60000),
      'signal': config.signal,
      'timeout': toInt(options.timeout, 15000, 1000, 600000),
      'userAgent': config.userAgent || options.userAgent
    },
    'signal': config.signal,
    'silent': !!config.silent,
    'sitemaps': toArray(config.sitemaps).map(normalizeUrl),
    'skip200': !!config.skip200,
    'subdomains': !!config.subdomains,
    'urls': [...new Set(toArray(config.urls).map(normalizeUrl))]
  };

  if (!normalized.crawl.length && !normalized.urls.length && !normalized.sitemaps.length) {
    throw new Error('Provide at least one of `crawl`, `urls` or `sitemaps`.');
  }

  normalized.export = toArray(config.export).map((details) => {
    const format = (details.format || 'xlsx').toLowerCase();
    if (!EXPORT_FORMATS.includes(format)) {
      throw new Error(`Unsupported export format "${format}". Use one of: ${EXPORT_FORMATS.join(', ')}.`);
    }

    let file = details.file;
    if (!file) {
      if (!details.location) {
        throw new Error('Missing export location.');
      } else if (!fs.existsSync(details.location)) {
        throw new Error(`Export location does not exist: ${details.location}`);
      }

      file = path.join(details.location, `httpstatuschecker-results-${Math.floor(Date.now() / 1000)}.${format}`);
    }

    return { file, format };
  });

  normalized.cloud = [];
  for (const [key, service] of Object.entries(CLOUD_SERVICES)) {
    if (!config[key]) {
      continue;
    }

    const cloudOptions = config[key] === true ? {} : { ...config[key] };
    // Fail before crawling, not after, if no credentials can be found.
    cloudOptions.credentials = service.resolveCredentials(cloudOptions);
    normalized.cloud.push({ key, 'options': cloudOptions });
  }

  // Nothing to upload yet: create an Excel report in the temp folder.
  if (normalized.cloud.length && !normalized.export.length) {
    const host = new URL(normalized.crawl[0] || normalized.urls[0] || normalized.sitemaps[0]).hostname;
    const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ').replace(':', '-');
    normalized.export.push({
      'file': path.join(os.tmpdir(), `HTTP status - ${host} - ${stamp}.xlsx`),
      'format': 'xlsx',
      'temporary': true
    });
  }

  return normalized;
}

function buildSummary(results, extra) {
  const counts = {};
  for (const result of results) {
    counts[result.category] = (counts[result.category] || 0) + 1;
  }

  return {
    ...extra,
    'counts': counts,
    'discovered': results.length,
    'issues': results.filter((result) => ISSUE_CATEGORIES.includes(result.category)).length,
    'orphans': results.filter((result) => result.orphan).length,
    'robotsBlocked': results.filter((result) => result.scope === 'robots').length
  };
}

// Upload failures are collected, not thrown, so the crawl results are never lost.
async function uploadReports(settings, report, log) {
  const uploads = [];
  const errors = [];

  for (const { key, options } of settings.cloud) {
    const service = CLOUD_SERVICES[key];
    const formats = options.formats ? toArray(options.formats) : EXPORT_FORMATS;
    const files = settings.export.filter((entry) => formats.includes(entry.format));

    try {
      const uploaded = await service.upload(files, options);
      uploaded.forEach((upload) => log(`Uploaded to ${service.label}${upload.public ? ' (public link)' : ''}: ${upload.name} → ${upload.url}`));
      uploads.push(...uploaded);
    } catch (error) {
      errors.push(error.message);
      log(`Error: ${error.message}`);
    }
  }

  report.uploads = uploads;
  if (errors.length) {
    report.uploadError = errors.join(' ');
    return;
  }

  for (const entry of settings.export.filter((item) => item.temporary)) {
    await fs.promises.rm(entry.file, { 'force': true });
  }
}

async function checkHttpStatus(config) {
  const settings = normalizeConfig(config);
  const authHosts = [...settings.crawl, ...settings.urls, ...settings.sitemaps].map((url) => new URL(url).hostname);
  const request = createRequester({ ...settings.options, authHosts });
  const progress = settings.silent ? null : createProgressPrinter();
  const log = (...args) => {
    if (!settings.silent) {
      console.error(...args);
    }
  };

  let sitemapEntries = [];
  if (settings.sitemaps.length) {
    sitemapEntries = await fetchSitemaps(settings.sitemaps, request, (url, message) => {
      log(`Error: could not read sitemap ${url} (${message})`);
    });

    if (!sitemapEntries.length && !settings.crawl.length && !settings.urls.length) {
      throw new Error('No URL(s) found in the sitemap(s).');
    }
  }

  const userProgress = settings.onProgress;
  const checker = new Checker({
    ...settings,
    'onProgress': (state) => {
      if (progress) {
        progress.update(state);
      }

      if (userProgress) {
        userProgress(state);
      }
    }
  }, request, settings.respectRobots ? createRobots(request, settings.options.userAgent) : null);

  // Aborting keeps everything checked so far; unfinished URLs are "Not checked".
  const stop = () => checker.stop();
  if (settings.signal) {
    if (settings.signal.aborted) {
      stop();
    }
    settings.signal.addEventListener('abort', stop, { 'once': true });
  }

  try {
    await checker.run(sitemapEntries);
  } finally {
    if (settings.signal) {
      settings.signal.removeEventListener('abort', stop);
    }
    if (progress) {
      progress.clear();
    }
  }

  const results = checker.results();
  const report = {
    'results': results,
    'summary': buildSummary(results, {
      ...checker.progress(),
      'crawl': settings.crawl,
      'exclude': settings.exclude,
      'include': settings.include,
      'sitemaps': settings.sitemaps
    })
  };

  for (const { file, format, temporary } of settings.export) {
    await writeReport(report, file, format, settings);
    if (!temporary) {
      log(`Saved ${format.toUpperCase()} report: ${file}`);
    }
  }

  if (settings.cloud.length) {
    await uploadReports(settings, report, log);
  }

  if (!settings.silent && (settings.printResults || !settings.export.length)) {
    printReport(report, { ...settings, 'skip200': settings.skip200 || settings.consoleIssuesOnly });
  } else if (!settings.silent) {
    log(`${report.summary.discovered} URLs checked, ${report.summary.issues} issue(s) found.`);
  }

  return report;
}

async function writeReport(report, file, format, options = {}) {
  if (format === 'xlsx') {
    await writeExcel(report, file, options);
  } else if (format === 'csv') {
    await writeCsv(report, file, options);
  } else if (format === 'json') {
    await fs.promises.writeFile(file, JSON.stringify(report, null, 2));
  } else if (format === 'html') {
    await writeHtml(report, file);
  } else {
    throw new Error(`Unsupported export format "${format}". Use one of: ${EXPORT_FORMATS.join(', ')}.`);
  }
}

async function recheck(report, urls, config = {}) {
  const targets = toArray(urls);
  if (!targets.length) {
    return report;
  }

  const fresh = await checkHttpStatus({
    'delay': config.delay,
    'maxRedirects': config.maxRedirects,
    'onResult': config.onResult,
    'options': config.options,
    'retries': config.retries,
    'signal': config.signal,
    'silent': true,
    'urls': targets,
    'userAgent': config.userAgent
  });

  const byUrl = new Map(report.results.map((result) => [result.url, result]));
  for (const result of fresh.results) {
    const existing = byUrl.get(result.url);
    if (!existing) {
      // A new redirect target: keep it so redirect chains stay complete.
      byUrl.set(result.url, { ...result, 'scope': 'list' });
      continue;
    }

    const updated = { ...existing, 'rechecked': true };
    STATUS_FIELDS.forEach((field) => {
      updated[field] = result[field];
    });
    updated.category = categorize(updated);
    byUrl.set(result.url, updated);
  }

  const results = [...byUrl.values()];
  return {
    ...report,
    'results': results,
    'summary': buildSummary(results, { ...report.summary, 'recheckedAt': Date.now() })
  };
}

module.exports = checkHttpStatus;
module.exports.checkHttpStatus = checkHttpStatus;
module.exports.findConfig = findConfig;
module.exports.loadConfig = loadConfig;
module.exports.recheck = recheck;
module.exports.renderHtml = renderHtml;
module.exports.writeReport = writeReport;
