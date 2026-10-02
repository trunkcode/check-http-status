'use strict';

const cheerio = require('cheerio');
const compilePatterns = require('./patterns');
const { AbortedError, bodyToText } = require('./request');

const SKIP_SCHEMES = /^(mailto:|tel:|javascript:|data:|sms:|ftp:|file:|blob:|#)/i;
const ISSUE_CATEGORIES = ['Redirect', 'Not Found', 'Client Error', 'Server Error', 'Error'];

const SCOPE_LABELS = {
  'asset': 'Asset',
  'crawl': 'Crawled',
  'depth': 'Skipped (max depth)',
  'excluded': 'Excluded by rule',
  'external': 'External (not crawled)',
  'limit': 'Skipped (max pages)',
  'list': 'Checked',
  'robots': 'Blocked by robots.txt'
};

function categorize(record) {
  const status = record.status;

  if (record.error) {
    return 'Error';
  } else if (record.botProtection) {
    return 'Blocked';
  } else if (status === null || status === undefined) {
    return 'Not checked';
  } else if (status >= 200 && status < 300) {
    return 'OK';
  } else if (status >= 300 && status < 400) {
    return 'Redirect';
  } else if (status === 404 || status === 410) {
    return 'Not Found';
  } else if (status >= 400 && status < 500) {
    return 'Client Error';
  } else if (status >= 500) {
    return 'Server Error';
  }

  return 'Other';
}

const stripWww = (host) => host.toLowerCase().replace(/^www\./, '');

class Checker {
  constructor(config, request, robots = null) {
    this.config = config;
    this.request = request;
    this.robots = robots;
    this.include = compilePatterns(config.include);
    this.exclude = compilePatterns(config.exclude);
    this.crawlMode = config.crawl.length > 0;
    this.initialMaxPages = config.maxPages;
    // In list mode "internal" means the hosts of the URLs the user supplied.
    this.rootHosts = new Set((this.crawlMode ? config.crawl : config.urls).map((url) => stripWww(new URL(url).host)));

    this.records = new Map();
    this.pageQueue = [];
    this.checkQueue = [];
    this.active = 0;
    this.crawlQueued = 0;
    this.pagesCrawled = 0;
    this.checked = 0;
    this.stopped = false;
    this.askingPageLimit = false;
    this.state = 'idle';
    this.startedAt = null;
    this.finishedAt = null;
  }

  run(sitemapEntries = []) {
    this.state = 'running';
    this.startedAt = Date.now();

    for (const url of this.config.crawl) {
      this.discover(url, {
        'kind': 'seed',
        'seed': 'crawl'
      });
    }

    for (const url of this.config.urls) {
      this.discover(url, {
        'kind': 'seed',
        'seed': 'list'
      });
    }

    for (const entry of sitemapEntries) {
      if (!this.crawlMode) {
        this.rootHosts.add(stripWww(new URL(entry.url).host));
      }

      this.discover(entry.url, {
        'fromUrl': entry.sitemap,
        'kind': 'sitemap',
        'seed': 'sitemap'
      });
    }

    return new Promise((resolve) => {
      this.resolveDone = resolve;
      this.pump();
      this.maybeFinish();
    });
  }

  stop() {
    this.stopped = true;
    this.pageQueue.length = 0;
    this.checkQueue.length = 0;
    this.maybeFinish();
  }

  isInternal(url) {
    const host = stripWww(url.host);

    if (this.rootHosts.has(host)) {
      return true;
    }

    if (this.config.subdomains) {
      for (const root of this.rootHosts) {
        if (host.endsWith('.' + root)) {
          return true;
        }
      }
    }

    return false;
  }

  isAllowed(href) {
    if (this.include.length && !this.include.some((pattern) => pattern.test(href))) {
      return false;
    }

    return !this.exclude.some((pattern) => pattern.test(href));
  }

  normalize(raw, base) {
    const href = String(raw || '').trim();
    if (!href || SKIP_SCHEMES.test(href)) {
      return null;
    }

    let url;
    try {
      url = new URL(href, base);
    } catch {
      return null;
    }

    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return null;
    }

    url.hash = '';
    if (this.config.ignoreQuery) {
      url.search = '';
    }

    return url;
  }

  classify(url, { from, kind, seed, isAsset }) {
    const href = url.href;
    const depth = from ? from.depth + (kind === 'redirect' ? 0 : 1) : 0;

    if (seed === 'crawl') {
      return { depth, 'scope': 'crawl' };
    } else if (seed === 'list' || (seed === 'sitemap' && !this.crawlMode)) {
      return { depth, 'scope': 'list' };
    } else if (kind === 'redirect' && from.scope === 'list') {
      return { depth, 'scope': 'list' };
    } else if (!this.isInternal(url)) {
      return { depth, 'scope': 'external' };
    } else if (isAsset) {
      return { depth, 'scope': 'asset' };
    } else if (!this.isAllowed(href)) {
      return { depth, 'scope': 'excluded' };
    } else if (this.config.maxDepth !== null && depth > this.config.maxDepth) {
      return { depth, 'scope': 'depth' };
    } else if (this.crawlQueued >= this.config.maxPages) {
      return { depth, 'scope': 'limit' };
    }

    return { depth, 'scope': 'crawl' };
  }

  discover(raw, { from = null, fromUrl = null, kind = 'link', anchor = '', base, isAsset = false, seed = null } = {}) {
    const url = this.normalize(raw, base || (from && from.url) || undefined);
    if (!url) {
      return;
    }

    const key = url.href;
    let record = this.records.get(key);

    if (!record) {
      const { depth, scope } = this.classify(url, { from, isAsset, kind, seed });
      if (scope === 'crawl') {
        this.crawlQueued++;
      }

      record = {
        'contentType': '',
        'crawled': false,
        'depth': depth,
        'error': '',
        'internal': this.isInternal(url),
        'isStart': seed === 'crawl',
        'linkType': isAsset ? 'asset' : 'page',
        'note': '',
        'queued': false,
        'redirectHops': kind === 'redirect' ? from.redirectHops + 1 : 0,
        'redirectTo': '',
        'responseTime': null,
        'scope': scope,
        'sources': new Map(),
        'status': null,
        'statusText': '',
        'title': '',
        'url': key
      };
      this.records.set(key, record);
      this.enqueue(record);
    } else if (seed === 'list' && !record.queued) {
      // A URL the user asked for explicitly is always checked.
      record.scope = 'list';
      this.enqueue(record);
    }

    const sourceUrl = from ? from.url : fromUrl;
    if (sourceUrl) {
      let source = record.sources.get(sourceUrl);
      if (!source) {
        source = {
          'anchors': new Set(),
          'count': 0,
          'kind': kind
        };
        record.sources.set(sourceUrl, source);
      }

      source.count++;
      if (anchor) {
        source.anchors.add(anchor);
      }
    }
  }

  enqueue(record) {
    const scope = record.scope;
    // `checkExternal` only applies to external links.
    const shouldCheck = ['crawl', 'list', 'excluded', 'asset'].includes(scope) || (scope === 'external' && this.config.checkExternal);

    if (this.stopped || record.queued || !shouldCheck) {
      return;
    }

    record.queued = true;
    if (scope === 'crawl') {
      this.pageQueue.push(record);
    } else {
      this.checkQueue.push(record);
    }
  }

  pump() {
    while (!this.stopped && this.active < this.config.concurrency && (this.pageQueue.length || this.checkQueue.length)) {
      // Pages first (breadth-first) so the site structure is discovered early.
      const record = this.pageQueue.length ? this.pageQueue.shift() : this.checkQueue.shift();

      this.active++;
      this.process(record)
        .then(() => true, (error) => {
          if (error instanceof AbortedError) {
            // Stopped mid-request: leave the URL as "Not checked" instead of an error.
            record.status = null;
            return false;
          }

          record.error = record.error || error.message || String(error);
          return true;
        })
        .then((finished) => {
          this.active--;
          if (finished) {
            this.checked++;
            if (this.config.onResult) {
              this.config.onResult(this.toResult(record));
            }
          }
          if (this.config.onProgress) {
            this.config.onProgress(this.progress());
          }
          this.pump();
          this.maybeFinish();
        });
    }
  }

  maybeFinish() {
    if (this.state !== 'running' || this.active > 0) {
      return;
    }

    if (this.stopped) {
      this.finish();
    } else if (this.pageQueue.length === 0 && this.checkQueue.length === 0 && !this.askingPageLimit) {
      if (this.config.onPageLimit && this.waitingPages() > 0) {
        this.askPageLimit();
      } else {
        this.finish();
      }
    }
  }

  finish() {
    this.askingPageLimit = false;
    this.state = this.stopped ? 'stopped' : 'done';
    this.finishedAt = Date.now();
    this.resolveDone();
  }

  waitingPages() {
    let count = 0;
    for (const record of this.records.values()) {
      if (record.scope === 'limit') {
        count++;
      }
    }

    return count;
  }

  // `true`: `maxPages` more, a number: that many more, `Infinity`: all.
  askPageLimit() {
    this.askingPageLimit = true;
    const progress = { ...this.progress(), 'waitingPages': this.waitingPages() };

    Promise.resolve()
      .then(() => this.config.onPageLimit(progress))
      .then((answer) => answer, () => false)
      .then((answer) => {
        if (this.state !== 'running') {
          return;
        }

        this.askingPageLimit = false;
        const more = answer === true ? this.initialMaxPages : Number(answer);
        if (this.stopped || !answer || !(more > 0)) {
          this.finish();
          return;
        }

        this.config.maxPages += more;
        for (const record of this.records.values()) {
          if (record.scope === 'limit' && this.crawlQueued < this.config.maxPages) {
            record.scope = 'crawl';
            this.crawlQueued++;
            this.enqueue(record);
          }
        }

        this.pump();
        this.maybeFinish();
      });
  }

  async process(record) {
    // robots.txt only applies to the crawled site.
    if (this.robots && this.crawlMode && record.internal) {
      const { allowed, crawlDelay } = await this.robots.check(record.url);
      if (crawlDelay && this.request.setHostDelay) {
        this.request.setHostDelay(new URL(record.url).host, crawlDelay);
      }

      if (!allowed) {
        record.scope = 'robots';
        return;
      }
    }

    const parse = record.scope === 'crawl';
    let response;

    if (parse) {
      response = await this.request(record.url, {
        'readBody': true
      });
    } else {
      // HEAD is cheap but many servers mishandle it, so retry with GET on any error.
      try {
        response = await this.request(record.url, {
          'method': 'HEAD'
        });
      } catch (error) {
        if (error instanceof AbortedError) {
          throw error;
        }
        response = null;
      }

      if (!response || response.status >= 400) {
        response = await this.request(record.url);
      }
    }

    record.status = response.status;
    record.statusText = response.statusText;
    record.contentType = response.contentType.split(';')[0].trim();
    record.responseTime = response.responseTime;
    if (response.botProtection) {
      record.botProtection = response.botProtection;
      record.note = `Bot protection (${response.botProtection}): check in a browser`;
      return;
    }

    if (response.status >= 300 && response.status < 400 && response.location) {
      const target = this.normalize(response.location, record.url);
      if (!target) {
        return;
      }

      record.redirectTo = target.href;
      if (record.redirectHops >= this.config.maxRedirects) {
        record.note = `Stopped after ${this.config.maxRedirects} redirects`;
        return;
      }

      this.discover(target.href, {
        'anchor': '(redirect)',
        'from': record,
        'isAsset': record.linkType === 'asset',
        'kind': 'redirect'
      });
      return;
    }

    if (parse && response.body && /html/i.test(response.contentType)) {
      record.crawled = true;
      this.pagesCrawled++;
      this.extractLinks(record, bodyToText(response.body));
    }
  }

  extractLinks(record, html) {
    const $ = cheerio.load(html);
    record.title = $('title').first().text().replace(/\s+/g, ' ').trim().slice(0, 300);

    let base = record.url;
    const baseHref = $('base[href]').attr('href');
    if (baseHref) {
      try {
        base = new URL(baseHref, record.url).href;
      } catch {
        // Ignore an invalid <base>.
      }
    }

    $('a[href], area[href]').each((_, el) => {
      const $el = $(el);
      const text = $el.text().replace(/\s+/g, ' ').trim() ||
        $el.attr('aria-label') ||
        $el.attr('title') ||
        $el.find('img[alt]').attr('alt') ||
        '';

      this.discover($el.attr('href'), {
        'anchor': text.slice(0, 200),
        'base': base,
        'from': record
      });
    });

    if (this.config.checkAssets) {
      const assets = [
        ['img[src]', 'src', 'image'],
        ['script[src]', 'src', 'script'],
        ['link[rel~="stylesheet"][href]', 'href', 'stylesheet'],
        ['link[rel~="icon"][href]', 'href', 'icon'],
        ['source[src], video[src], audio[src]', 'src', 'media'],
        ['iframe[src]', 'src', 'iframe']
      ];

      for (const [selector, attr, label] of assets) {
        $(selector).each((_, el) => {
          this.discover($(el).attr(attr), {
            'anchor': `(${label})`,
            'base': base,
            'from': record,
            'isAsset': true
          });
        });
      }
    }
  }

  redirectChain(record) {
    const chain = [];
    const seen = new Set();
    let current = record;

    while (current && current.redirectTo) {
      if (seen.has(current.url)) {
        return { chain, 'loop': true };
      }

      seen.add(current.url);
      const next = this.records.get(current.redirectTo);
      chain.push({
        'status': next ? next.status : null,
        'url': current.redirectTo
      });
      current = next;
    }

    return { chain, 'loop': false };
  }

  // Linked directly, or via a URL that redirects here.
  isLinked(record, seen = new Set()) {
    if (seen.has(record.url)) {
      return false;
    }
    seen.add(record.url);

    for (const [page, source] of record.sources) {
      if (source.kind === 'link') {
        return true;
      }

      const from = source.kind === 'redirect' && this.records.get(page);
      if (from && this.isLinked(from, seen)) {
        return true;
      }
    }

    return false;
  }

  progress() {
    const counts = {};
    for (const record of this.records.values()) {
      const category = categorize(record);
      counts[category] = (counts[category] || 0) + 1;
    }

    return {
      'active': this.active,
      'checked': this.checked,
      'counts': counts,
      'discovered': this.records.size,
      'elapsed': this.startedAt ? (this.finishedAt || Date.now()) - this.startedAt : 0,
      'finishedAt': this.finishedAt,
      'mode': this.crawlMode ? 'crawl' : 'list',
      'pageLimitReached': this.crawlMode && this.crawlQueued >= this.config.maxPages,
      'pagesCrawled': this.pagesCrawled,
      'queued': this.pageQueue.length + this.checkQueue.length,
      'startedAt': this.startedAt,
      'state': this.state
    };
  }

  results() {
    return [...this.records.values()].map((record) => this.toResult(record));
  }

  toResult(record) {
    const { chain, loop } = record.redirectTo ? this.redirectChain(record) : { 'chain': [], 'loop': false };
    const final = chain[chain.length - 1];
    const foundOn = [...record.sources].map(([page, source]) => ({
      'anchors': [...source.anchors],
      'count': source.count,
      'kind': source.kind,
      'page': page
    }));
    const inSitemap = foundOn.some((source) => source.kind === 'sitemap');

    return {
      'botProtection': record.botProtection || '',
      'category': categorize(record),
      'contentType': record.contentType,
      'crawled': record.crawled,
      'depth': record.depth,
      'error': record.error,
      'finalStatus': final ? final.status : null,
      'finalUrl': final ? final.url : '',
      'foundOn': foundOn,
      'inSitemap': inSitemap,
      'linkType': record.linkType,
      'note': loop ? 'Redirect loop' : record.note,
      'orphan': this.crawlMode && inSitemap && !record.isStart && !this.isLinked(record),
      'redirectChain': chain,
      'redirectCount': chain.length,
      'redirectTo': record.redirectTo,
      'responseTime': record.responseTime,
      'scope': record.scope,
      'status': record.status,
      'statusText': record.statusText,
      'title': record.title,
      'type': record.internal ? 'internal' : 'external',
      'url': record.url
    };
  }
}

module.exports = {
  Checker,
  ISSUE_CATEGORIES,
  SCOPE_LABELS,
  categorize
};
