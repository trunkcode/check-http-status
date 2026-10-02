'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_NAMES = ['check-http-status.config.json', '.check-http-statusrc.json'];

// `checkHttpStatus()` options plus `fail` (CLI / Action).
const KNOWN_KEYS = [
  '$schema', 'checkAssets', 'checkExternal', 'concurrency', 'crawl', 'delay', 'exclude', 'export', 'fail',
  'googleDrive', 'ignoreQuery', 'include', 'maxDepth', 'maxPages', 'maxRedirects', 'oneDrive', 'options',
  'respectRobots', 'retries', 'retryDelay', 'silent', 'sitemaps', 'skip200', 'subdomains', 'urls', 'userAgent'
];

function findConfig(dir = process.cwd()) {
  for (const name of DEFAULT_NAMES) {
    const file = path.join(dir, name);
    if (fs.existsSync(file)) {
      return file;
    }
  }

  return null;
}

// Relative paths are resolved against the config file's folder.
function loadConfig(file) {
  const absolute = path.resolve(file);
  let config;

  if (/\.c?js$/.test(absolute)) {
    config = require(absolute);
  } else {
    let text;
    try {
      text = fs.readFileSync(absolute, 'utf8');
    } catch (error) {
      throw new Error(`Cannot read config file ${file}: ${error.message}`, { 'cause': error });
    }

    try {
      config = JSON.parse(text.replace(/^\uFEFF/, ''));
    } catch (error) {
      throw new Error(`Config file ${file} is not valid JSON: ${error.message}`, { 'cause': error });
    }
  }

  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new Error(`Config file ${file} must contain an object.`);
  }

  const unknown = Object.keys(config).filter((key) => !KNOWN_KEYS.includes(key));
  if (unknown.length) {
    throw new Error(`Unknown option(s) in ${file}: ${unknown.join(', ')}.`);
  }

  const dir = path.dirname(absolute);
  const resolve = (value) => (value && !path.isAbsolute(value) ? path.join(dir, value) : value);
  const result = { ...config };
  delete result.$schema;

  if (result.export) {
    result.export = (Array.isArray(result.export) ? result.export : [result.export]).map((entry) => ({
      ...entry,
      'file': resolve(entry.file),
      'location': resolve(entry.location)
    }));
  }

  if (result.googleDrive && typeof result.googleDrive === 'object' && result.googleDrive.keyFile) {
    result.googleDrive = { ...result.googleDrive, 'keyFile': resolve(result.googleDrive.keyFile) };
  }

  return result;
}

module.exports = {
  KNOWN_KEYS,
  findConfig,
  loadConfig
};
