'use strict';

const http = require('http');
const zlib = require('zlib');

// Fake "Acme Outdoor" site with every kind of problem, plus a fake external site.
function layout(title, body) {
  return `<!doctype html><html><head><title>${title} | Acme Outdoor</title>` +
    '<link rel="stylesheet" href="/assets/style.css"><link rel="icon" href="/favicon.ico"></head><body>' +
    '<nav><a href="/">Home</a> <a href="/products/">Products</a> <a href="/blog/">Blog</a> <a href="/about-us">About</a> <a href="/contact">Contact</a></nav>' +
    `<main>${body}</main>` +
    '<footer><a href="/privacy">Privacy</a> <a href="EXTERNAL/acme-outdoor">Instagram</a> <a href="mailto:hello@acme.test">Email us</a> <a href="#top">Back to top</a></footer>' +
    '</body></html>';
}

const PAGES = {
  '/': layout('Home', '<h1>Gear for every trail</h1><a href="/products/tents">Tents</a> <a href="/products/backpacks">Backpacks</a> <a href="/summer-sale">Summer sale</a> <a href="/docs/">Help centre</a> <img src="/images/hero.jpg" alt="Hero">'),
  '/about-us': layout('About us', '<p>Founded in 2009.</p><a href="/team">Meet the team</a> <a href="EXTERNAL/partners">Our partners</a> <a href="/careers">Careers</a>'),
  '/blog/': layout('Blog', '<a href="/blog/best-hiking-trails">Best hiking trails</a> <a href="/blog/packing-list?ref=blog">Packing list</a> <a href="/blog/2019/old-news">Old news</a>'),
  '/blog/best-hiking-trails': layout('Best hiking trails', '<p>Our picks.</p><a href="/products/tents">Get a tent</a> <a href="EXTERNAL/trail-guide">Trail guide</a> <a href="EXTERNAL/deleted-article">Source article</a> <img src="/images/missing-trail.jpg" alt="Trail">'),
  '/blog/packing-list': layout('Packing list', '<a href="/products/backpacks">Backpacks</a> <a href="/products/stoves">Stoves</a> <a href="EXTERNAL/head-not-allowed">Checklist PDF</a>'),
  '/contact': layout('Contact', '<form action="/contact"></form><a href="/store-locator">Store locator</a>'),
  '/docs/': layout('Help centre', '<a href="/docs/returns">Returns</a> <a href="/docs/shipping">Shipping</a>'),
  '/docs/returns': layout('Returns', '<a href="/docs/internal-only">Internal notes</a>'),
  '/new-arrivals': layout('New arrivals', '<a href="/products/tents">Tents</a>'),
  '/privacy': layout('Privacy', '<p>We respect your privacy.</p>'),
  '/products/': layout('Products', '<a href="/products/tents">Tents</a> <a href="/products/backpacks">Backpacks</a> <a href="/products/sleeping-bags">Sleeping bags</a> <a href="/products/stoves">Stoves</a>'),
  '/products/backpacks': layout('Backpacks', '<a href="/products/backpacks/trailblazer-40l">Trailblazer 40L</a>'),
  '/products/backpacks/trailblazer-40l': layout('Trailblazer 40L', '<a href="/products/backpacks">Back to backpacks</a> <a href="/size-guide">Size guide</a>'),
  '/products/tents': layout('Tents', '<a href="/products/tents/summit-2p">Summit 2P</a> <a href="/products/tents/basecamp-4p">Basecamp 4P</a>'),
  '/products/tents/basecamp-4p': layout('Basecamp 4P', '<p>Roomy.</p>'),
  '/products/tents/summit-2p': layout('Summit 2P', '<p>Ultralight.</p><a href="/reviews/summit-2p">Reviews</a>'),
  '/size-guide': layout('Size guide', '<p>Find your fit.</p>'),
  '/team': layout('Team', '<p>Our people.</p>'),
  '/unlinked-landing-page': layout('Spring campaign', '<p>Only in the sitemap.</p>')
};

const REDIRECTS = {
  '/careers': [301, 'https://jobs.example.invalid/acme'],
  '/old-blog': [301, '/blog/'],
  '/products/sleeping-bags': [301, '/products/sleeping-bags/'],
  '/products/sleeping-bags/': [302, '/collections/sleeping-bags'],
  '/store-locator': [302, '/stores'],
  '/stores': [302, '/store-locator'],
  '/summer-sale': [301, '/new-arrivals']
};

const STATUS = {
  '/blog/2019/old-news': 410,
  '/products/stoves': 500,
  '/reviews/summit-2p': 503
};

function sitemapXml(urls) {
  return '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' +
    urls.map((url) => `<url><loc>${url}</loc></url>`).join('') + '</urlset>';
}

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`)));
}

async function startSite() {
  let origin = '';
  let externalOrigin = '';
  const requests = [];
  const failures = new Map();
  const state = { 'fixed': false };

  const external = http.createServer((req, res) => {
    const pathname = req.url.split('?')[0];
    if (pathname === '/head-not-allowed' && req.method === 'HEAD') {
      res.writeHead(405);
      return res.end();
    } else if (['/acme-outdoor', '/partners', '/trail-guide', '/head-not-allowed'].includes(pathname)) {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      return res.end('<title>External</title><a href="/should-not-be-crawled">x</a>');
    }

    res.writeHead(404, { 'Content-Type': 'text/html' });
    res.end('Not found');
  });

  const site = http.createServer((req, res) => {
    const pathname = req.url.split('?')[0];
    requests.push({ 'method': req.method, 'path': pathname, 'time': Date.now(), 'userAgent': req.headers['user-agent'] });

    // /flaky/<n>: "503 Service Unavailable" for the first n requests, then 200.
    const flaky = pathname.match(/^\/flaky\/(\d+)$/);
    if (flaky) {
      const count = (failures.get(pathname) || 0) + 1;
      failures.set(pathname, count);
      res.writeHead(count <= Number(flaky[1]) ? 503 : 200, { 'Retry-After': '0' });
      return res.end();
    } else if (pathname === '/always-429') {
      res.writeHead(429, { 'Retry-After': '0' });
      return res.end();
    } else if (pathname === '/slow') {
      const timer = setTimeout(() => {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end('slow');
      }, 3000);
      req.on('close', () => clearTimeout(timer));
      return;
    } else if (pathname === '/robots.txt' && state.robotsStatus) {
      res.writeHead(state.robotsStatus, { 'Content-Type': 'text/plain' });
      return res.end(state.robots || '');
    } else if (pathname === '/cf-protected') {
      res.writeHead(403, { 'Content-Type': 'text/html', 'cf-mitigated': 'challenge', 'Server': 'cloudflare' });
      return res.end('Just a moment...');
    } else if (pathname === '/datadome-protected') {
      res.writeHead(429, { 'Retry-After': '0', 'x-datadome': 'protected' });
      return res.end();
    } else if (pathname === '/plain-403') {
      res.writeHead(403);
      return res.end();
    } else if (pathname === '/toggle') {
      res.writeHead(state.fixed ? 200 : 404);
      return res.end();
    }

    if (pathname === '/sitemap_index.xml') {
      res.writeHead(200, { 'Content-Type': 'application/xml' });
      return res.end(`<?xml version="1.0"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><sitemap><loc>${origin}/page-sitemap.xml</loc></sitemap><sitemap><loc>${origin}/post-sitemap.xml.gz</loc></sitemap></sitemapindex>`);
    } else if (pathname === '/page-sitemap.xml') {
      res.writeHead(200, { 'Content-Type': 'application/xml' });
      return res.end(sitemapXml(['/', '/about-us', '/products/', '/unlinked-landing-page', '/old-blog', '/new-arrivals'].map((p) => origin + p)));
    } else if (pathname === '/post-sitemap.xml.gz') {
      res.writeHead(200, { 'Content-Type': 'application/gzip' });
      return res.end(zlib.gzipSync(sitemapXml(['/blog/best-hiking-trails', '/blog/deleted-post'].map((p) => origin + p))));
    } else if (pathname === '/staff') {
      const expected = 'Basic ' + Buffer.from('admin:secret').toString('base64');
      if (req.headers.authorization !== expected) {
        res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="staff"' });
        return res.end();
      }

      res.writeHead(200, { 'Content-Type': 'text/html' });
      return res.end('<title>Staff</title>ok');
    } else if (pathname === '/echo-headers') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(req.headers));
    } else if (REDIRECTS[pathname]) {
      res.writeHead(REDIRECTS[pathname][0], { 'Location': REDIRECTS[pathname][1] });
      return res.end();
    } else if (STATUS[pathname]) {
      res.writeHead(STATUS[pathname], { 'Content-Type': 'text/html' });
      return res.end('Error');
    } else if (pathname.startsWith('/assets/') || pathname === '/favicon.ico' || pathname === '/images/hero.jpg') {
      res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
      return res.end('');
    } else if (PAGES[pathname]) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(PAGES[pathname].replace(/EXTERNAL/g, externalOrigin));
    }

    res.writeHead(404, { 'Content-Type': 'text/html' });
    res.end('<title>Not found</title>');
  });

  origin = await listen(site);
  externalOrigin = await listen(external);

  return {
    'close': () => Promise.all([site, external].map((server) => new Promise((resolve) => server.close(resolve)))),
    'externalOrigin': externalOrigin,
    'origin': origin,
    'requests': requests,
    'state': state
  };
}

module.exports = startSite;
