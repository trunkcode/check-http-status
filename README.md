# check-http-status

[![NPM version][npm-image]][npm-url]
[![Downloads][downloads-image]][npm-url]
[![CI][ci-image]][ci-url]

Crawl a website or check a list of URLs, and get HTTP status codes, full
redirect chains, and broken links, along with **the pages each broken link was found on**.
Export to Excel, CSV, JSON or a shareable, interactive HTML report.

**[Website & live demo report →](https://trunkcode.github.io/check-http-status/)**

```bash
npx check-http-status https://www.example.com --exclude /docs -o report.xlsx
```

It runs on your own machine (macOS, Windows, Linux), so it can also check
staging sites, password-protected sites (HTTP Basic auth) and sites that are
only reachable over a VPN.

## Features

- **Crawl a whole site** from a start URL, breadth-first, with `maxPages` and `maxDepth` limits.
- **Where was it found?** Every broken link and redirect lists the pages that link to it, with the link text.
- **Redirect chains:** every hop, the final URL and status, and redirect-loop detection.
- **External links** are checked but never crawled.
- **No false alarms from bot protection:** links to sites behind Cloudflare, DataDome and similar services, which block all automated checkers, are reported as **Blocked** (check them in a browser) instead of broken.
- **Include / exclude rules** (substring, `*` wildcard or `/regex/`). Excluded URLs are still listed and checked, just not crawled.
- **Sitemaps:** `<urlset>`, `<sitemapindex>` (Yoast, Rank Math, WordPress core) and `.xml.gz`. Combined with a crawl, it flags **orphan pages** (in the sitemap but not linked from anywhere).
- **Assets** (optional): images, scripts, stylesheets, icons, iframes.
- **Reports:** Excel, CSV, JSON and HTML. Reports always list **every URL found, once**. The first columns are **URL**, **Found On** (every page that links to it, in one cell) and **Redirect To**, followed by the status. The Excel workbook has these sheets:
  - **Summary:** totals per status.
  - **All URLs:** every crawled page, asset and external link.
  - **Issues:** redirects, 4xx, 5xx and connection errors.
  - **External Links:** external links (checked, not crawled).
- **Google Drive & OneDrive:** upload reports straight to the cloud, optionally with a public link. On Google Drive, spreadsheets become Google Sheets.
- **Polite and resilient:** retries temporary errors (honouring `Retry-After`), with an optional delay between requests, a custom User-Agent and optional robots.txt support.
- **Config file** shared by the CLI, the GitHub Action and your own apps, with a JSON Schema for editor autocomplete.
- **TypeScript** type definitions included.
- **CI friendly:** `--fail` exits with code 1 when broken links are found.

## Install

Requires Node.js 18.17 or newer.

```bash
# Run without installing
npx check-http-status --help

# Or install globally / as a dev dependency
npm install -g check-http-status
npm install check-http-status --save-dev
```

## Command line

```bash
# Crawl a site (the terminal lists issues only; saved reports list every URL)
check-http-status https://www.example.com

# Don't crawl /docs, but still list and check those links; save Excel + HTML reports
check-http-status crawl example.com -e /docs -o report.xlsx -o report.html

# Optional: add a sitemap index → also finds orphan pages
check-http-status crawl example.com -s https://example.com/sitemap_index.xml

# Only check the given URLs (no crawling)
check-http-status check https://example.com/old-page https://example.com/pricing --all

# Check every URL in a sitemap, or in a text file (one URL per line)
check-http-status check -s https://example.com/sitemap.xml --issues-only
check-http-status check -f urls.txt -o results.csv

# Password-protected staging site
CHS_AUTH=user:pass check-http-status https://staging.example.com

# Fail a CI job if broken links are found
check-http-status https://www.example.com --fail -o report.html
```

Example output:

```
301  https://example.com/summer-sale → https://example.com/new-arrivals
       found on https://example.com/ ("Summer sale")
301  https://example.com/products/sleeping-bags → https://example.com/products/sleeping-bags/ ⇒ https://example.com/collections/sleeping-bags (404, 2 hops)
       found on https://example.com/products/ ("Sleeping bags")
410  https://example.com/blog/2019/old-news
       found on https://example.com/blog/ ("Old news")
500  https://example.com/products/stoves
       found on https://example.com/products/ ("Stoves")
       found on https://example.com/blog/packing-list ("Stoves")

36 URLs (17 pages crawled, 2s): 22 OK, 7 redirects, 4 not found, 2 other 4xx/5xx, 1 errors
```

Run `check-http-status --help` for every option.

## Node.js

```js
const checkHttpStatus = require('check-http-status');

// Just pass the website URL - pages are found by crawling, no sitemap needed.
const report = await checkHttpStatus({
  'crawl': 'https://www.example.com',
  'exclude': ['/docs'],
  'maxPages': 2000,
  'export': [
    { 'format': 'xlsx', 'location': '/Users/me/Desktop/' },
    { 'format': 'html', 'file': '/Users/me/Desktop/report.html' }
  ],
  'options': {
    'auth': { 'username': 'user', 'password': 'pass' },
    'headers': { 'Accept-Language': 'en' },
    'timeout': 15000
  }
});

console.log(report.summary.counts); // { OK: 412, Redirect: 9, 'Not Found': 3, ... }

for (const result of report.results.filter((r) => r.category === 'Not Found')) {
  console.log(result.url, 'found on', result.foundOn.map((source) => source.page));
}
```

### Optional: add a sitemap

Sitemaps are never required. Adding one to a crawl also checks sitemap pages that
nothing links to, and flags them as orphans:

```js
checkHttpStatus({
  'crawl': 'https://www.example.com',
  'sitemaps': ['https://www.example.com/sitemap_index.xml']
});
```

### Check a list of URLs (v1 style)

```js
checkHttpStatus({
  'sitemaps': ['https://www.trunkcode.com/page-sitemap.xml'],
  'urls': ['https://example.com/', 'https://www.trunkcode.com/test/'],
  'skip200': true,
  'export': {
    'format': 'xlsx',
    'location': '/Users/trunkcode/Desktop/'
  }
});
```

### Parameters

| Parameter | Type | Default | Description |
|---|---|---|---|
| `crawl` | String / Array | | Website URL to crawl. Pages are discovered by following internal links. |
| `urls` | Array | | URLs to check (with their redirects), without crawling. |
| `sitemaps` | Array | | *Optional.* Sitemap / sitemap index URLs. With `crawl`, their pages are crawled too and orphans are flagged; without it, their URLs are checked. |
| `include` | Array / String | | Only crawl URLs matching one of these rules. |
| `exclude` | Array / String | | Don't crawl URLs matching these rules. They are still listed and checked. |
| `maxPages` | Number | `1000` | Maximum pages to crawl. Later pages are listed as "Skipped (max pages)". |
| `maxDepth` | Number | unlimited | Maximum link depth from the start URL. |
| `checkExternal` | Boolean | `true` | Check the status of external links. Excluded pages and assets are always checked. |
| `checkAssets` | Boolean | `false` | Also check images, scripts, stylesheets, icons and iframes. |
| `subdomains` | Boolean | `false` | Treat subdomains of the start URL as internal. |
| `ignoreQuery` | Boolean | `false` | Strip query strings before comparing URLs. |
| `respectRobots` | Boolean | `false` | Don't request URLs disallowed by the site's robots.txt (listed as "Blocked by robots.txt"), and honour `Crawl-delay`. |
| `concurrency` | Number | `10` | Parallel requests. |
| `delay` | Number | `0` | Minimum milliseconds between requests to the same site. Use it for sites that rate-limit. |
| `retries` | Number | `2` | Retries for 429, 502, 503, 504 and dropped connections, honouring `Retry-After`. 404s, DNS failures and refused connections are not retried. |
| `retryDelay` | Number | `1000` | Wait before the first retry (milliseconds), doubled for each further retry. |
| `userAgent` | String | identifies check-http-status | User-Agent header. |
| `maxRedirects` | Number | `10` | Redirects to follow per URL. |
| `skip200` | Boolean | `false` | Leave 200 URLs out of the console output and the URL sheet/CSV (v1 behaviour). By default reports contain every URL. |
| `export` | Object / Array | | `{ format, location }` or `{ format, file }`. Formats: `xlsx`, `csv`, `json`, `html`. |
| `options.auth` | Object | | `{ username, password }` for HTTP Basic auth. Only sent to the crawled/checked hosts. |
| `options.headers` | Object | | Extra request headers. |
| `options.timeout` | Number | `15000` | Timeout per request in milliseconds. |
| `googleDrive` | Boolean / Object | | Upload reports to Google Drive: `{ folderId, folderName, convert, public, credentials, keyFile }`. See [Upload reports to Google Drive](#upload-reports-to-google-drive). |
| `oneDrive` | Boolean / Object | | Upload reports to OneDrive: `{ folderPath, public, credentials, clientId, refreshToken, tenant }`. See [Upload reports to OneDrive](#upload-reports-to-onedrive). |
| `silent` | Boolean | `false` | No console output. |
| `signal` | AbortSignal | | Stop the crawl. Everything checked so far is returned; unfinished URLs are "Not checked". |
| `onResult` | Function | | Called with each result as soon as its URL is checked (live results). |
| `onProgress` | Function | | Called with progress stats after each URL. |

Provide at least one of `crawl`, `urls` or `sitemaps`. For a full site audit, `crawl` on its own is enough.

Rules match as a case-insensitive substring (`/docs`), a wildcard
(`*/products/*`) or a regular expression (`/\/page\/\d+/`).

### TypeScript

Type definitions are included:

```ts
import checkHttpStatus = require('check-http-status');

const report: checkHttpStatus.Report = await checkHttpStatus({ crawl: 'https://www.example.com' });
const broken: checkHttpStatus.Result[] = report.results.filter((r) => r.category === 'Not Found');
```

### Use it in your own app

`signal`, `onResult` and `recheck()` are made for apps built on top of the
library (like a desktop UI): stop a crawl, show results as they arrive, and
re-check URLs after fixing them without crawling again.

```js
const { checkHttpStatus, recheck, writeReport } = require('check-http-status');

const controller = new AbortController();
stopButton.onclick = () => controller.abort();

let report = await checkHttpStatus({
  'crawl': 'https://www.example.com',
  'signal': controller.signal,
  'silent': true,
  'onResult': (result) => table.addRow(result),
  'onProgress': (progress) => statusBar.update(progress)
});

// Later, after fixing some links. Where each URL was found is kept from the crawl.
report = await recheck(report, ['https://www.example.com/old-page']);
await writeReport(report, 'report.xlsx', 'xlsx');
```

### Result

`checkHttpStatus()` resolves to `{ summary, results }`. Each result has:

| Field | Description |
|---|---|
| `url` | The URL. |
| `status`, `statusText`, `category` | e.g. `404`, `Not Found`, and one of `OK`, `Redirect`, `Not Found`, `Client Error`, `Server Error`, `Error`, `Blocked`, `Not checked`. |
| `botProtection` | Set when a bot-protection service (Cloudflare, DataDome, Akamai, PerimeterX, Sucuri) answered instead of the page. These are reported as `Blocked`: check them in a browser. They are not counted as broken and don't trigger `--fail`. |
| `error` | Connection error (timeout, DNS, TLS…) if the request failed. |
| `type`, `linkType`, `scope` | `internal`/`external`, `page`/`asset`, and whether it was crawled, excluded, checked or skipped. |
| `redirectTo`, `redirectChain`, `finalUrl`, `finalStatus`, `redirectCount` | Redirect details. `note` is set for loops or too many redirects. |
| `foundOn` | `[{ page, anchors, count, kind }]`, where `kind` is `link`, `redirect` or `sitemap`. |
| `title`, `contentType`, `responseTime`, `depth`, `inSitemap`, `orphan` | Page details. |

## Config file

Save your settings in **`check-http-status.config.json`**. The CLI picks it up
from the current folder automatically, or use `--config <file>`. The same file
works for the GitHub Action and for apps that call `loadConfig()`.

```json
{
  "$schema": "https://unpkg.com/check-http-status/schema.json",
  "crawl": "https://www.example.com",
  "exclude": ["/docs", "/wp-admin"],
  "maxPages": 2000,
  "respectRobots": true,
  "delay": 250,
  "export": [
    { "format": "xlsx", "file": "reports/link-report.xlsx" },
    { "format": "html", "file": "reports/link-report.html" }
  ],
  "fail": true
}
```

```bash
check-http-status                      # uses check-http-status.config.json
check-http-status --max-pages 50       # flags override the file
check-http-status -e /blog             # -i / -e / -s add to the file's lists
check-http-status --config audits/client-a.json
```

- **Options:** it accepts the same options as the Node.js API (see [Parameters](#parameters)), plus `"fail": true`.
- **Units:** durations are in **milliseconds**, as in Node.js. On the command line they are seconds.
- **Paths:** relative paths (report files, `googleDrive.keyFile`) are relative to the config file.
- **Typos:** unknown options are reported as errors.
- **Editor support:** the `$schema` line gives autocomplete and validation in VS Code and other editors.
- **Secrets:** keep passwords and tokens out of the file and use environment variables (`CHS_AUTH`, `CHS_GOOGLE_CREDENTIALS`, `CHS_ONEDRIVE_CREDENTIALS`).

```js
const { checkHttpStatus, loadConfig } = require('check-http-status');
const report = await checkHttpStatus({ ...loadConfig('check-http-status.config.json'), 'silent': true });
```

## robots.txt

By default every link is checked, which is usually what you want when auditing
your own site. Add `--respect-robots` (or `"respectRobots": true`) to skip URLs
that your robots.txt disallows:

- Blocked URLs are still listed, with the pages that link to them, as **"Blocked by robots.txt"**, but are never requested.
- **`Crawl-delay`** is honoured (up to 30 seconds).
- **Which rules apply:** the rules for your User-Agent's product token (`check-http-status`, or e.g. `AuditBot` for `--user-agent "AuditBot/1.0"`) are used if present, otherwise the `*` rules.
- **Scope:** only the site being crawled is affected. External links are single status checks.
- **Missing or unreachable robots.txt:** a missing robots.txt (404) allows everything. As RFC 9309 requires, one that can't be fetched (5xx or network error) blocks everything.

## Upload reports to Google Drive

Add `--drive` to upload the report when the crawl finishes. Excel and CSV
reports are converted to **Google Sheets** (use `--no-convert` to keep the
file). Without `-o`, an Excel report is created and uploaded.

```bash
check-http-status https://www.example.com --drive
check-http-status https://www.example.com -o report.xlsx -o report.html --drive
```

Files go into a **"HTTP Status Reports"** folder that the tool creates in your
Drive (rename it with `--drive-folder-name`). By default the tool can only see
files and folders it created itself, never the rest of your Drive.

### One-time setup (your own Google account)

1. In the [Google Cloud console](https://console.cloud.google.com/), create a project and **enable the Google Drive API**.
2. Set up the **OAuth consent screen** (External), add your email as a test user, then **publish** the app. While it's in "Testing", Google expires the login after 7 days.
3. Under **Credentials**, create an **OAuth client ID** of type **Desktop app**.
4. Sign in once. The refresh token is saved to `~/.config/check-http-status/` (on Windows, `%APPDATA%\check-http-status\`):

   ```bash
   check-http-status drive-login --client-id <id> --client-secret <secret>
   ```

To upload into **an existing folder of yours**, sign in with
`drive-login --full-access`, then pass the folder ID from its URL
(`drive.google.com/drive/folders/<ID>`) with `--drive-folder <ID>`.

### CI / GitHub Actions

Either reuse your login: store the contents of the saved
`google-credentials.json` as a secret named `CHS_GOOGLE_CREDENTIALS`. Or use a
**service account**: store its JSON key as `CHS_GOOGLE_CREDENTIALS` (or point
`GOOGLE_APPLICATION_CREDENTIALS` / `--drive-key` at the file), share the target
folder with the service account's email, and pass `--drive-folder`. Service
accounts have no storage of their own, so the folder must be in a **Shared
Drive** (Google Workspace).

```yaml
- run: npx check-http-status https://www.example.com --drive --drive-folder ${{ vars.DRIVE_FOLDER_ID }}
  env:
    CHS_GOOGLE_CREDENTIALS: ${{ secrets.CHS_GOOGLE_CREDENTIALS }}
```

In Node.js, pass `googleDrive`. The uploaded files are returned in `report.uploads`:

```js
const report = await checkHttpStatus({
  'crawl': 'https://www.example.com',
  'googleDrive': { 'folderId': '1AbC…', 'convert': true } // or `googleDrive: true`
});

console.log(report.uploads); // [{ service, name, url, public, id, file }]
console.log(report.uploadError); // set if the upload failed (the crawl results are still returned)
```

### Share with anyone

Add `--public` (or `'public': true`) to make each uploaded file viewable by
anyone with the link. The link is printed and returned in `report.uploads`.
Google Workspace and Microsoft 365 admins can block public links. If yours does,
the upload still succeeds and you get an error explaining why.

```bash
check-http-status https://www.example.com --drive --public
```

## Upload reports to OneDrive

Works with personal OneDrive and OneDrive for work or school. Excel reports open
directly in Excel for the web.

```bash
check-http-status https://www.example.com --onedrive
check-http-status https://www.example.com -o report.xlsx --onedrive --onedrive-public
```

Files go into the app's own folder, **Apps/&lt;your app name&gt;**. The tool can't
see anything else in your OneDrive.

### One-time setup

1. In the [Microsoft Entra admin center](https://entra.microsoft.com/) (or Azure portal), open **App registrations**, then **New registration**.
   Choose who can sign in: personal accounts, work accounts, or both.
2. Under **Authentication**, add the platform **Mobile and desktop applications** with the redirect URI `http://localhost`.
3. Copy the **Application (client) ID**. No client secret is needed.
4. Sign in once:

   ```bash
   check-http-status onedrive-login --client-id <application-id>
   # Work/school only: --tenant <tenant-id>. Personal only: --tenant consumers
   ```

To upload into **your own folder** (e.g. `Documents/SEO`), sign in with
`onedrive-login --full-access` and pass `--onedrive-folder "Documents/SEO"`.
Missing folders are created.

For CI, store the contents of the saved `onedrive-credentials.json` as a
secret named `CHS_ONEDRIVE_CREDENTIALS`.

In Node.js:

```js
const report = await checkHttpStatus({
  'crawl': 'https://www.example.com',
  'oneDrive': { 'folderPath': 'Documents/SEO', 'public': true } // or `oneDrive: true`
});
```

## Upgrading from v1

v1 configs keep working. Changes in v2:

- Node.js 18.17+ is required (it uses the built-in `fetch`, so axios is no longer a dependency).
- `checkHttpStatus()` now **returns** `{ summary, results }`.
- Invalid config **throws** instead of calling `process.exit()`.
- Excel/CSV columns changed: one row per URL with its full redirect chain and the pages it was found on, plus Summary, Issues and External Links sheets.
- `export.location` no longer needs a trailing slash.

## License

MIT

[npm-image]: https://img.shields.io/npm/v/check-http-status.svg
[npm-url]: https://www.npmjs.com/package/check-http-status
[downloads-image]: https://img.shields.io/npm/dt/check-http-status.svg
[ci-image]: https://github.com/trunkcode/check-http-status/actions/workflows/ci.yml/badge.svg
[ci-url]: https://github.com/trunkcode/check-http-status/actions/workflows/ci.yml
