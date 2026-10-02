# check-http-status changelog

## Unreleased

### New

- `onPageLimit` option: when `maxPages` is reached, ask whether to keep crawling instead of stopping (for apps built on the library)

### Changed

- `maxPages` (`--max-pages`) now defaults to 5000 instead of 1000

## 2.0.1 - Oct 2, 2026

### Fixed

- README parameters table rendering

## 2.0.0 - Oct 2, 2026

### New

- Crawl a whole website (`crawl`) and report every link's status with the pages it was found on and the link text
- Command line tool: `npx check-http-status <url>` with `crawl` and `check` commands
- Include / exclude rules (substring, wildcard or regex). Excluded URLs are listed and checked, but not crawled
- External links are checked but never crawled
- Sitemap index (`<sitemapindex>`) and gzipped sitemap (`.xml.gz`) support
- Orphan page detection (pages in the sitemap that aren't linked from anywhere)
- Optional asset checks (images, scripts, stylesheets, icons, iframes)
- New report formats: interactive HTML and JSON; reports list every URL found once (URL, Found On, Redirect To, Status, …); Excel report has Summary, All URLs, Issues and External Links sheets
- `maxPages`, `maxDepth`, `concurrency`, `maxRedirects`, `subdomains`, `ignoreQuery`, `onProgress` options
- `--fail` flag to fail CI builds when broken links are found
- Upload reports to Google Drive (`--drive` / `googleDrive`), with Excel/CSV converted to Google Sheets; `drive-login` command; service account support for CI
- Upload reports to OneDrive (`--onedrive` / `oneDrive`), personal or work/school; `onedrive-login` command
- Public "anyone with the link" sharing for uploads (`--public`, `--drive-public`, `--onedrive-public`)
- Retries for 429/502/503/504 and dropped connections, honouring `Retry-After` (`retries`, `retryDelay`)
- `delay` between requests to the same site, and a custom `userAgent`
- For apps built on the library: `signal` (stop a crawl), `onResult` (live results), `recheck()` and `writeReport()`
- Optional robots.txt support (`--respect-robots` / `respectRobots`), including Crawl-delay
- Config file (`check-http-status.config.json` or `--config <file>`) with a JSON Schema; `loadConfig()` / `findConfig()`
- TypeScript type definitions
- Bot-protection challenges (Cloudflare, DataDome, Akamai, PerimeterX, Sucuri) are reported as `Blocked` instead of broken links
- The terminal lists issues even when reports are saved with `-o`
- `checkHttpStatus()` returns `{ summary, results }`

### Fixed

- Requests ran in batches of 10 that waited for the slowest request; now a worker pool keeps every slot busy
- Redirect loops caused infinite recursion
- Relative `Location` headers (e.g. `/new-page`) were reported as errors
- Sitemap index files crashed the sitemap reader
- Progress output crashed when stdout was not a terminal (CI, pipes)
- De-duplicating large sitemaps was O(n²)
- HTTP Basic auth credentials are no longer sent to external sites
- Export location no longer requires a trailing slash

### Breaking

- Requires Node.js 18.17+
- Throws errors instead of calling `process.exit()`
- Excel/CSV columns changed (one row per URL with its full redirect chain)
- Replaced `axios`, `columnify` and `xml2js` with built-in `fetch` and `cheerio`

## 1.3.0 - Oct 15, 2021

### Enhancement

- Allow Sitemap(s) and particular URL(s) together
- Limit Promise to max. 10 concurrent requests
- Show progress of the HTTP Status list

## 1.2.0 - May 21, 2021

### Enhancement

- Allow to add multiple sitemap URLs to fetch the list of pages.

## 1.1.0 - May 18, 2021

### Enhancement

- Skipping the URLs from the list that are returning HTTP code `200` to reduce the length of the list.

## 1.0.0 - Apr 22, 2021

- Initial Release
