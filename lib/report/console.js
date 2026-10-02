'use strict';

const { ISSUE_CATEGORIES } = require('../checker');

const useColor = (stream) => stream.isTTY && !process.env.NO_COLOR;
const paint = (code, text, stream = process.stdout) => (useColor(stream) ? `\x1b[${code}m${text}\x1b[0m` : text);

const CATEGORY_COLORS = {
  'Blocked': 35,
  'Client Error': 31,
  'Error': 31,
  'Not Found': 31,
  'OK': 32,
  'Redirect': 33,
  'Server Error': 31
};

// Progress line on stderr; silent when stderr isn't a terminal (CI, pipes).
function createProgressPrinter(stream = process.stderr) {
  let last = 0;

  return {
    clear() {
      if (stream.isTTY) {
        stream.clearLine(0);
        stream.cursorTo(0);
      }
    },
    update(progress, force = false) {
      if (!stream.isTTY || (!force && Date.now() - last < 150)) {
        return;
      }

      last = Date.now();
      const issues = ISSUE_CATEGORIES.reduce((sum, key) => sum + (progress.counts[key] || 0), 0);
      const text = progress.mode === 'crawl'
        ? `Crawled ${progress.pagesCrawled} pages · checked ${progress.checked}/${progress.checked + progress.queued + progress.active} URLs · ${issues} issues`
        : `Checked ${progress.checked}/${progress.checked + progress.queued + progress.active} URLs · ${issues} issues`;

      stream.clearLine(0);
      stream.cursorTo(0);
      stream.write(text.slice(0, (stream.columns || 120) - 1));
    }
  };
}

function printReport(report, options = {}) {
  const { summary } = report;
  const maxSources = options.maxSources === undefined ? 3 : options.maxSources;
  const rows = report.results
    .filter((result) => !options.skip200 || result.category !== 'OK')
    .sort((a, b) => (a.status || 999) - (b.status || 999) || a.url.localeCompare(b.url));

  console.log();
  for (const result of rows) {
    const label = result.error ? 'ERR' : String(result.status === null ? '---' : result.status);
    let line = `${paint(CATEGORY_COLORS[result.category] || 90, label.padEnd(4))} ${result.url}`;

    if (result.redirectTo) {
      const final = result.redirectCount > 1 ? ` ⇒ ${result.finalUrl} (${result.finalStatus === null ? '?' : result.finalStatus}, ${result.redirectCount} hops)` : '';
      line += paint(90, ` → ${result.redirectTo}${final}`);
    }

    if (result.error) {
      line += paint(90, `  ${result.error}`);
    }

    if (result.note) {
      line += paint(90, `  [${result.note}]`);
    }

    console.log(line);

    if (maxSources > 0 && ISSUE_CATEGORIES.includes(result.category)) {
      const linked = result.foundOn.filter((source) => source.kind !== 'redirect');
      const sources = linked.length ? linked : result.foundOn;
      for (const source of sources.slice(0, maxSources)) {
        const anchor = source.anchors.find((text) => text && text[0] !== '(');
        const label = source.kind === 'redirect' ? 'redirected from' : 'found on';
        console.log(paint(90, `       ${label} ${source.page}${anchor ? ` ("${anchor}")` : ''}`));
      }

      if (sources.length > maxSources) {
        console.log(paint(90, `       … and ${sources.length - maxSources} more page(s)`));
      }
    }
  }

  printSummary(summary, rows.length === 0 && options.skip200);
}

function printSummary(summary, allOk) {
  const counts = summary.counts;
  const parts = [
    paint(32, `${counts['OK'] || 0} OK`),
    paint(33, `${counts['Redirect'] || 0} redirects`),
    paint(31, `${counts['Not Found'] || 0} not found`),
    paint(31, `${(counts['Client Error'] || 0) + (counts['Server Error'] || 0)} other 4xx/5xx`),
    paint(31, `${counts['Error'] || 0} errors`)
  ];
  if (counts['Blocked']) {
    parts.push(paint(35, `${counts['Blocked']} blocked by bot protection`));
  }

  console.log();
  if (allOk) {
    console.log(paint(32, 'All the URLs are 200 and there is nothing to worry about!'));
  }

  const crawled = summary.mode === 'crawl' ? `${summary.pagesCrawled} pages crawled, ` : '';
  console.log(`${summary.discovered} URLs (${crawled}${Math.round(summary.elapsed / 1000)}s): ${parts.join(', ')}`);

  if (summary.orphans) {
    console.log(paint(33, `${summary.orphans} orphan page(s): listed in the sitemap but not linked from any crawled page.`));
  }

  if (summary.robotsBlocked) {
    console.log(paint(33, `${summary.robotsBlocked} URL(s) skipped because robots.txt disallows them.`));
  }

  if (summary.pageLimitReached) {
    console.log(paint(33, 'Max pages reached - increase maxPages (--max-pages) to crawl more.'));
  }
}

module.exports = {
  createProgressPrinter,
  paint,
  printReport
};
