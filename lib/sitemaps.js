'use strict';

const cheerio = require('cheerio');
const { bodyToText } = require('./request');

const MAX_SITEMAPS = 500;

// Supports <urlset>, <sitemapindex> and gzipped sitemaps.
async function fetchSitemaps(sitemapUrls, request, onError = () => {}) {
  const queue = [...sitemapUrls];
  const seenSitemaps = new Set();
  const pages = new Map();

  while (queue.length && seenSitemaps.size < MAX_SITEMAPS) {
    const batch = queue.splice(0, 5).filter((url) => !seenSitemaps.has(url));
    batch.forEach((url) => seenSitemaps.add(url));

    await Promise.all(batch.map(async (sitemapUrl) => {
      try {
        const { locs, isIndex } = await fetchSitemap(sitemapUrl, request);
        for (const loc of locs) {
          if (isIndex) {
            queue.push(loc);
          } else if (!pages.has(loc)) {
            pages.set(loc, sitemapUrl);
          }
        }
      } catch (error) {
        onError(sitemapUrl, error.message);
      }
    }));
  }

  return [...pages].map(([url, sitemap]) => ({
    'sitemap': sitemap,
    'url': url
  }));
}

async function fetchSitemap(sitemapUrl, request) {
  let url = sitemapUrl;
  let response;

  for (let hops = 0; hops <= 10; hops++) {
    response = await request(url, {
      'readBody': true
    });

    if (response.status >= 300 && response.status < 400 && response.location) {
      url = new URL(response.location, url).href;
      continue;
    }

    break;
  }

  if (response.status !== 200) {
    throw new Error(`HTTP ${response.status}`);
  }

  const xml = bodyToText(response.body);
  if (!/<(urlset|sitemapindex)[\s>]/i.test(xml)) {
    throw new Error('Not a sitemap XML file');
  }

  const $ = cheerio.load(xml, {
    'xml': true
  });
  const isIndex = $('sitemapindex').length > 0;
  const selector = isIndex ? 'sitemapindex > sitemap > loc' : 'urlset > url > loc';
  const locs = $(selector)
    .map((_, el) => $(el).text().trim())
    .get()
    .filter(Boolean)
    .map((loc) => {
      try {
        return new URL(loc, url).href;
      } catch {
        return null;
      }
    })
    .filter(Boolean);

  return {
    'isIndex': isIndex,
    'locs': locs
  };
}

module.exports = fetchSitemaps;
