'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { after, before, describe, test } = require('node:test');
const { execFile } = require('child_process');
const startSite = require('./fixtures/site');
const { findConfig, loadConfig } = require('../index');

const CLI = path.join(__dirname, '..', 'bin', 'check-http-status.js');
let site;
let tmp;

before(async () => {
  site = await startSite();
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chs-config-'));
});

after(async () => {
  await site.close();
  fs.rmSync(tmp, { 'force': true, 'recursive': true });
});

const run = (args, cwd) => new Promise((resolve) => {
  execFile(process.execPath, [CLI, ...args], { cwd, 'env': { ...process.env, 'NO_COLOR': '1' } }, (error, stdout, stderr) => {
    resolve({ 'code': error ? error.code : 0, stderr, stdout });
  });
});

function project(name, config) {
  const dir = path.join(tmp, name);
  fs.mkdirSync(path.join(dir, 'reports'), { 'recursive': true });
  fs.writeFileSync(path.join(dir, 'check-http-status.config.json'), JSON.stringify(config, null, 2));
  return dir;
}

describe('loadConfig', () => {
  test('resolves report and key paths relative to the config file and drops $schema', () => {
    const dir = project('paths', {
      '$schema': 'https://unpkg.com/check-http-status/schema.json',
      'crawl': 'https://example.com',
      'export': [{ 'file': 'reports/site.xlsx', 'format': 'xlsx' }, { 'format': 'csv', 'location': 'reports' }],
      'googleDrive': { 'keyFile': 'keys/sa.json' }
    });

    const config = loadConfig(path.join(dir, 'check-http-status.config.json'));
    assert.strictEqual(config.$schema, undefined);
    assert.strictEqual(config.export[0].file, path.join(dir, 'reports', 'site.xlsx'));
    assert.strictEqual(config.export[1].location, path.join(dir, 'reports'));
    assert.strictEqual(config.googleDrive.keyFile, path.join(dir, 'keys', 'sa.json'));
    assert.strictEqual(findConfig(dir), path.join(dir, 'check-http-status.config.json'));
    assert.strictEqual(findConfig(tmp), null);
  });

  test('rejects typos and invalid JSON with clear messages', () => {
    const typo = path.join(project('typo', { 'crawl': 'https://example.com', 'excludes': ['/docs'] }), 'check-http-status.config.json');
    assert.throws(() => loadConfig(typo), /Unknown option\(s\) in .*: excludes/);

    const broken = path.join(tmp, 'broken.json');
    fs.writeFileSync(broken, '{ "crawl": ');
    assert.throws(() => loadConfig(broken), /is not valid JSON/);
    assert.throws(() => loadConfig(path.join(tmp, 'missing.json')), /Cannot read config file/);
  });

  test('the JSON schema lists exactly the supported options', () => {
    const schema = require('../schema.json');
    const { KNOWN_KEYS } = require('../lib/config');
    assert.deepStrictEqual(Object.keys(schema.properties).sort(), [...KNOWN_KEYS].sort());
  });
});

describe('CLI with a config file', () => {
  test('picks up check-http-status.config.json from the current folder', async () => {
    const dir = project('auto', {
      'checkExternal': false,
      'crawl': site.origin,
      'exclude': ['/docs'],
      'export': { 'file': 'reports/site.json', 'format': 'json' },
      'fail': true
    });

    const { code, stderr } = await run([], dir);
    assert.match(stderr, /Using config check-http-status\.config\.json/);
    assert.strictEqual(code, 1, '"fail": true in the config sets the exit code');

    const report = JSON.parse(fs.readFileSync(path.join(dir, 'reports', 'site.json'), 'utf8'));
    assert.deepStrictEqual(report.summary.exclude, ['/docs']);
    assert.strictEqual(report.results.find((r) => r.url === site.origin + '/docs/').scope, 'excluded');
  });

  test('flags override the config; -e adds to its exclude list', async () => {
    const dir = project('override', {
      'checkExternal': false,
      'crawl': site.origin,
      'exclude': ['/docs'],
      'export': { 'file': 'reports/site.json', 'format': 'json' },
      'maxPages': 100
    });

    await run(['--max-pages', '2', '-e', '/blog', '-q'], dir);
    const report = JSON.parse(fs.readFileSync(path.join(dir, 'reports', 'site.json'), 'utf8'));
    assert.strictEqual(report.summary.pagesCrawled, 2);
    assert.deepStrictEqual(report.summary.exclude, ['/docs', '/blog']);

    // A CLI URL and -o replace the config's.
    const out = path.join(dir, 'other.json');
    await run([site.origin + '/products/', '-o', out, '-q'], dir);
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(out, 'utf8')).summary.crawl, [site.origin + '/products/']);
  });

  test('--config loads a file from anywhere; --no-config ignores the local one', async () => {
    const dir = project('explicit', { 'crawl': site.origin, 'export': { 'file': 'reports/x.json', 'format': 'json' }, 'maxPages': 1 });
    const { code } = await run(['--config', path.join(dir, 'check-http-status.config.json'), '-q'], tmp);
    assert.strictEqual(code, 0);
    assert.ok(fs.existsSync(path.join(dir, 'reports', 'x.json')), 'export path resolved next to the config');

    const ignored = await run(['--no-config'], dir);
    assert.strictEqual(ignored.code, 2);
    assert.match(ignored.stdout, /^check-http-status v/);
  });

  test('reports config errors', async () => {
    const dir = project('bad', { 'crawl': site.origin, 'maxpages': 5 });
    const { code, stderr } = await run([], dir);
    assert.strictEqual(code, 2);
    assert.match(stderr, /Unknown option\(s\) in .*: maxpages/);
  });
});
