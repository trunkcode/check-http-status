#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { parseArgs } = require('util');
const checkHttpStatus = require('../index');
const { findConfig, loadConfig } = require('../lib/config');
const pkg = require('../package.json');

const HELP = `check-http-status v${pkg.version}

Crawl a website or check a list of URLs for HTTP status codes, redirect chains
and broken links, and see which pages link to them.

Usage
  check-http-status crawl <url> [options]       Crawl a website starting from <url>
  check-http-status check <url...> [options]    Check only the given URLs / sitemaps
  check-http-status <url> [options]             Same as "crawl"
  check-http-status drive-login [options]       Connect your Google Drive account (once)
  check-http-status onedrive-login [options]    Connect your OneDrive account (once)

Crawl options
  -i, --include <text>     Only crawl URLs containing <text> (repeatable)
  -e, --exclude <text>     Don't crawl URLs containing <text>; they are still listed
                           and their status is checked (repeatable)
                           Rules may use * wildcards or /regex/
      --max-pages <n>      Max pages to crawl (default 1000)
      --max-depth <n>      Max link depth from the start URL (default unlimited)
      --no-external        Don't check the status of external links (excluded
                           pages and assets are still checked)
      --assets             Also check images, scripts, stylesheets and iframes
      --subdomains         Treat subdomains as internal
      --ignore-query       Ignore query strings (?a=b) when comparing URLs
      --respect-robots     Don't request URLs that the site's robots.txt disallows
                           (they are listed as "Blocked by robots.txt"); also
                           honours Crawl-delay. Off by default

Config file
      --config <file>      Load settings from a JSON config file. Flags override it;
                           -i/-e/-s add to its lists. Without --config,
                           check-http-status.config.json in the current folder is
                           used if present
      --no-config          Ignore check-http-status.config.json

Optional input
  -s, --sitemap <url>      Read URLs from a sitemap or sitemap index (repeatable).
                           Not needed for crawling: pages are found from links.
                           With "crawl", sitemap pages are crawled too and pages
                           not linked from anywhere are reported as orphans
  -f, --file <path>        Read URLs from a text file, one per line

Requests
  -c, --concurrency <n>    Parallel requests (default 10)
  -t, --timeout <sec>      Timeout per request (default 15)
      --delay <sec>        Wait between requests to the same site, e.g. 0.5
                           (default 0). Use it if the site rate-limits you
      --retries <n>        Retries for 429/502/503/504 and dropped connections,
                           honouring Retry-After (default 2)
      --max-redirects <n>  Max redirects to follow per URL (default 10)
      --user-agent <text>  User-Agent header (default identifies check-http-status)
  -a, --auth <user:pass>   HTTP Basic auth (only sent to the site being checked).
                           Can also be set with the CHS_AUTH environment variable
  -H, --header <k: v>      Extra request header (repeatable)

Output
  -o, --output <file>      Save a report; format from the extension:
                           .xlsx, .csv, .json or .html (repeatable)
      --issues-only        Leave 200 OK URLs out of the terminal output and reports
                           (the terminal shows issues only for "crawl" by default;
                           saved reports always list every URL unless this is set)
      --all                Also list 200 OK URLs in the terminal
      --fail               Exit with code 1 if broken links (4xx/5xx/errors) are found
  -q, --quiet              No progress or console output

Cloud upload (without -o, an Excel report is created and uploaded)
      --public             Make uploaded files viewable by anyone with the link
                           (both services)

  Google Drive
      --drive              Upload the report(s) to Google Drive. Excel/CSV become
                           Google Sheets
      --drive-public       Anyone with the link can view the Google Drive files
      --drive-folder <id>  Upload into this existing folder (ID from its URL). Needs
                           "drive-login --full-access" or a service account the
                           folder is shared with. Default: a "HTTP Status Reports"
                           folder created by this tool
      --drive-folder-name <name>  Name of the folder this tool creates and reuses
      --drive-key <file>   Service account key file (for CI). Default: the account
                           from "drive-login", or CHS_GOOGLE_CREDENTIALS /
                           GOOGLE_APPLICATION_CREDENTIALS
      --no-convert         Upload .xlsx/.csv as files instead of Google Sheets

  OneDrive
      --onedrive           Upload the report(s) to OneDrive (personal or work)
      --onedrive-public    Return "anyone with the link" view links
      --onedrive-folder <path>  Upload into this folder path, e.g. "Reports/SEO".
                           Needs "onedrive-login --full-access". Default: the
                           app's own folder (Apps/<app name>)

  Login commands
      --client-id <id>     OAuth client ID (or CHS_GOOGLE_CLIENT_ID / CHS_ONEDRIVE_CLIENT_ID)
      --client-secret <s>  Google OAuth client secret (or CHS_GOOGLE_CLIENT_SECRET)
      --tenant <id>        OneDrive: "common" (default), "consumers",
                           "organizations" or your tenant ID
      --full-access        Allow uploads into your own folders, not just the
                           tool's own folder

  -h, --help               Show this help
  -v, --version            Show version

Examples
  check-http-status https://www.example.com -e /docs -o report.xlsx
  check-http-status crawl example.com --sitemap https://example.com/sitemap.xml -o report.html
  check-http-status check https://example.com/old-page https://example.com/missing
  check-http-status check --sitemap https://example.com/sitemap_index.xml --issues-only --fail
  check-http-status https://www.example.com --delay 0.5 --user-agent "MyAuditBot/1.0"
  check-http-status https://www.example.com --drive --public
  check-http-status https://www.example.com -o report.xlsx --onedrive --onedrive-folder Reports
`;

function fail(message) {
  console.error(`Error: ${message}\nRun "check-http-status --help" for usage.`);
  process.exit(2);
}

function parseHeaders(list) {
  const headers = {};
  for (const header of list) {
    const index = header.indexOf(':');
    if (index < 1) {
      fail(`Invalid header "${header}". Use "Name: value".`);
    }

    headers[header.slice(0, index).trim()] = header.slice(index + 1).trim();
  }

  return headers;
}

function parseAuth(value) {
  if (!value) {
    return undefined;
  }

  const index = value.indexOf(':');
  return {
    'password': index === -1 ? '' : value.slice(index + 1),
    'username': index === -1 ? value : value.slice(0, index)
  };
}

function seconds(value) {
  return value === undefined ? undefined : Math.round(parseFloat(value) * 1000);
}

async function driveLogin(values) {
  const { login } = require('../lib/google-drive');
  const clientId = values['client-id'] || process.env.CHS_GOOGLE_CLIENT_ID;
  const clientSecret = values['client-secret'] || process.env.CHS_GOOGLE_CLIENT_SECRET;

  if (!clientId) {
    fail('drive-login needs an OAuth client ID: --client-id <id> --client-secret <secret>.\n' +
      'Create one at https://console.cloud.google.com/apis/credentials (type "Desktop app") and enable the Google Drive API.');
  }

  const file = await login({ clientId, clientSecret, 'fullAccess': values['full-access'] });
  console.log(`Google Drive connected. Credentials saved to ${file}`);
  console.log('Upload reports with: check-http-status <url> --drive');
}

async function oneDriveLogin(values) {
  const { login } = require('../lib/onedrive');
  const clientId = values['client-id'] || process.env.CHS_ONEDRIVE_CLIENT_ID;

  if (!clientId) {
    fail('onedrive-login needs an application (client) ID: --client-id <id>.\n' +
      'Register one at https://entra.microsoft.com → App registrations, with platform "Mobile and desktop applications" and redirect URI http://localhost.');
  }

  const file = await login({ clientId, 'fullAccess': values['full-access'], 'tenant': values.tenant });
  console.log(`OneDrive connected. Credentials saved to ${file}`);
  console.log('Upload reports with: check-http-status <url> --onedrive');
}

async function main() {
  let parsed;
  try {
    parsed = parseArgs({
      'allowPositionals': true,
      'options': {
        'all': { 'type': 'boolean' },
        'assets': { 'type': 'boolean' },
        'auth': { 'short': 'a', 'type': 'string' },
        'client-id': { 'type': 'string' },
        'client-secret': { 'type': 'string' },
        'concurrency': { 'short': 'c', 'type': 'string' },
        'config': { 'type': 'string' },
        'delay': { 'type': 'string' },
        'drive': { 'type': 'boolean' },
        'drive-folder': { 'type': 'string' },
        'drive-folder-name': { 'type': 'string' },
        'drive-key': { 'type': 'string' },
        'drive-public': { 'type': 'boolean' },
        'exclude': { 'multiple': true, 'short': 'e', 'type': 'string' },
        'fail': { 'type': 'boolean' },
        'file': { 'multiple': true, 'short': 'f', 'type': 'string' },
        'full-access': { 'type': 'boolean' },
        'header': { 'multiple': true, 'short': 'H', 'type': 'string' },
        'help': { 'short': 'h', 'type': 'boolean' },
        'ignore-query': { 'type': 'boolean' },
        'include': { 'multiple': true, 'short': 'i', 'type': 'string' },
        'issues-only': { 'type': 'boolean' },
        'max-depth': { 'type': 'string' },
        'max-pages': { 'type': 'string' },
        'max-redirects': { 'type': 'string' },
        'no-config': { 'type': 'boolean' },
        'no-convert': { 'type': 'boolean' },
        'no-external': { 'type': 'boolean' },
        'onedrive': { 'type': 'boolean' },
        'onedrive-folder': { 'type': 'string' },
        'onedrive-public': { 'type': 'boolean' },
        'output': { 'multiple': true, 'short': 'o', 'type': 'string' },
        'public': { 'type': 'boolean' },
        'quiet': { 'short': 'q', 'type': 'boolean' },
        'respect-robots': { 'type': 'boolean' },
        'retries': { 'type': 'string' },
        'sitemap': { 'multiple': true, 'short': 's', 'type': 'string' },
        'subdomains': { 'type': 'boolean' },
        'tenant': { 'type': 'string' },
        'timeout': { 'short': 't', 'type': 'string' },
        'user-agent': { 'type': 'string' },
        'version': { 'short': 'v', 'type': 'boolean' }
      }
    });
  } catch (error) {
    fail(error.message);
  }

  const { values } = parsed;
  let positionals = parsed.positionals;

  if (values.help) {
    process.stdout.write(HELP);
    return;
  } else if (values.version) {
    console.log(pkg.version);
    return;
  }

  if (positionals[0] === 'drive-login' || positionals[0] === 'onedrive-login') {
    try {
      await (positionals[0] === 'drive-login' ? driveLogin(values) : oneDriveLogin(values));
    } catch (error) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
    return;
  }

  let command = 'crawl';
  let explicitCommand = null;
  if (['crawl', 'check'].includes(positionals[0])) {
    command = explicitCommand = positionals[0];
    positionals = positionals.slice(1);
  }

  let urls = [...positionals];
  for (const file of values.file || []) {
    try {
      urls = urls.concat(fs.readFileSync(file, 'utf8').split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith('#')));
    } catch (error) {
      fail(`Cannot read ${file}: ${error.message}`);
    }
  }

  // Settings from a config file come first; flags given on the command line win.
  let fileConfig = {};
  const configFile = values.config || (values['no-config'] ? null : findConfig());
  if (configFile) {
    try {
      fileConfig = loadConfig(configFile);
    } catch (error) {
      fail(error.message);
    }

    if (!values.quiet) {
      console.error(`Using config ${path.relative(process.cwd(), path.resolve(configFile)) || configFile}`);
    }
  }

  const exportList = (values.output || []).map((file) => {
    const format = path.extname(file).slice(1).toLowerCase();
    if (!['xlsx', 'csv', 'json', 'html'].includes(format)) {
      fail(`Unknown report format for "${file}". Use .xlsx, .csv, .json or .html.`);
    }

    return { 'file': path.resolve(file), format };
  });

  const cli = {};
  const set = (key, value) => {
    if (value !== undefined) {
      cli[key] = value;
    }
  };

  set('checkAssets', values.assets);
  set('checkExternal', values['no-external'] ? false : undefined);
  set('concurrency', values.concurrency);
  set('delay', seconds(values.delay));
  set('export', exportList.length ? exportList : undefined);
  set('fail', values.fail);
  set('ignoreQuery', values['ignore-query']);
  set('maxDepth', values['max-depth']);
  set('maxPages', values['max-pages']);
  set('maxRedirects', values['max-redirects']);
  set('respectRobots', values['respect-robots']);
  set('retries', values.retries);
  set('silent', values.quiet);
  set('skip200', values['issues-only']);
  set('subdomains', values.subdomains);
  set('userAgent', values['user-agent']);

  const config = { ...fileConfig, ...cli };

  // Rules and sitemaps from the command line are added to the config file's.
  for (const key of ['include', 'exclude', 'sitemaps']) {
    const fromCli = values[key === 'sitemaps' ? 'sitemap' : key];
    if (fromCli) {
      config[key] = [...[].concat(fileConfig[key] || []), ...fromCli];
    }
  }

  const fileOptions = fileConfig.options || {};
  config.options = {
    ...fileOptions,
    'auth': parseAuth(values.auth || process.env.CHS_AUTH) || fileOptions.auth,
    'headers': { ...(fileOptions.headers || {}), ...parseHeaders(values.header || []) },
    'timeout': seconds(values.timeout) || fileOptions.timeout
  };

  if (values.drive || values['drive-public'] || values['drive-folder'] || values['drive-folder-name'] || values['drive-key'] || values['no-convert'] || (values.public && fileConfig.googleDrive)) {
    const base = typeof fileConfig.googleDrive === 'object' ? fileConfig.googleDrive : {};
    config.googleDrive = { ...base };
    const drive = config.googleDrive;
    if (values['no-convert']) {
      drive.convert = false;
    }
    if (values['drive-folder']) {
      drive.folderId = values['drive-folder'];
    }
    if (values['drive-folder-name']) {
      drive.folderName = values['drive-folder-name'];
    }
    if (values['drive-key']) {
      drive.keyFile = values['drive-key'];
    }
    if (values.public || values['drive-public']) {
      drive.public = true;
    }
  }

  if (values.onedrive || values['onedrive-public'] || values['onedrive-folder'] || (values.public && fileConfig.oneDrive)) {
    const base = typeof fileConfig.oneDrive === 'object' ? fileConfig.oneDrive : {};
    config.oneDrive = { ...base };
    if (values['onedrive-folder']) {
      config.oneDrive.folderPath = values['onedrive-folder'];
    }
    if (values.public || values['onedrive-public']) {
      config.oneDrive.public = true;
    }
  }

  if (values.public && !config.googleDrive && !config.oneDrive) {
    fail('--public needs --drive and/or --onedrive.');
  }

  if (urls.length) {
    // With several URLs, the first is the start page and the rest are extra seeds.
    if (command === 'crawl') {
      config.crawl = urls;
      delete config.urls;
    } else {
      config.urls = urls;
      delete config.crawl;
    }
  } else if (explicitCommand === 'check' && config.crawl) {
    // "check" with a config that crawls: check the start URL(s) only.
    config.urls = [].concat(config.urls || [], config.crawl);
    delete config.crawl;
  }

  const isCrawl = [].concat(config.crawl || []).length > 0;
  if (!isCrawl && ![].concat(config.urls || []).length && ![].concat(config.sitemaps || []).length) {
    process.stdout.write(HELP);
    process.exit(2);
  }

  // Terminal shows issues only; reports keep every URL.
  config.consoleIssuesOnly = !values.all && isCrawl;
  config.printResults = true;
  const failOnBroken = !!config.fail;
  delete config.fail;

  // First Ctrl+C stops and keeps results; second one quits.
  const controller = new AbortController();
  const onInterrupt = () => {
    if (controller.signal.aborted) {
      process.exit(130);
    }

    console.error('\nStopping… (press Ctrl+C again to quit immediately)');
    controller.abort();
  };
  config.signal = controller.signal;
  process.on('SIGINT', onInterrupt);

  let report;
  try {
    report = await checkHttpStatus(config);
  } catch (error) {
    fail(error.message);
  } finally {
    process.removeListener('SIGINT', onInterrupt);
  }

  if (report.uploadError) {
    process.exitCode = 1;
  }

  if (failOnBroken) {
    const counts = report.summary.counts;
    const broken = (counts['Not Found'] || 0) + (counts['Client Error'] || 0) + (counts['Server Error'] || 0) + (counts['Error'] || 0);
    if (broken > 0) {
      process.exitCode = 1;
    }
  }
}

main();
