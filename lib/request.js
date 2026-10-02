'use strict';

const zlib = require('zlib');

const DEFAULT_USER_AGENT = 'Mozilla/5.0 (compatible; check-http-status/2.0; +https://github.com/trunkcode/check-http-status)';
const MAX_BODY_BYTES = 15 * 1024 * 1024;
const MAX_RETRY_WAIT = 60 * 1000;
// Temporary failures only; DNS, refused and TLS errors aren't retried.
const RETRY_STATUSES = [429, 502, 503, 504];
const RETRY_ERRORS = ['ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'EPIPE', 'UND_ERR_SOCKET', 'UND_ERR_CONNECT_TIMEOUT', 'TIMEOUT'];

class AbortedError extends Error {
  constructor() {
    super('Aborted');
    this.name = 'AbortedError';
  }
}

const sleep = (ms, signal) => new Promise((resolve, reject) => {
  if (signal && signal.aborted) {
    return reject(new AbortedError());
  }

  const onAbort = () => {
    clearTimeout(timer);
    reject(new AbortedError());
  };
  const timer = setTimeout(() => {
    if (signal) {
      signal.removeEventListener('abort', onAbort);
    }
    resolve();
  }, ms);

  if (signal) {
    signal.addEventListener('abort', onAbort, { 'once': true });
  }
});

// Challenge pages a browser would pass; not broken links.
function detectBotProtection(response) {
  if (![403, 429, 503].includes(response.status)) {
    return '';
  }

  const header = (name) => response.headers.get(name);
  if (header('cf-mitigated') === 'challenge') {
    return 'Cloudflare';
  } else if (header('x-datadome') || /datadome=/.test(header('set-cookie') || '')) {
    return 'DataDome';
  } else if (/_abck=|ak_bmsc=/.test(header('set-cookie') || '')) {
    return 'Akamai Bot Manager';
  } else if (header('x-px-blocked') || /_px[23]?=/.test(header('set-cookie') || '')) {
    return 'PerimeterX';
  } else if (header('x-sucuri-block')) {
    return 'Sucuri';
  }

  return '';
}

// Seconds or HTTP date from a Retry-After header, in milliseconds.
function retryAfterMs(header) {
  if (!header) {
    return null;
  }

  const seconds = Number(header);
  if (!Number.isNaN(seconds)) {
    return seconds * 1000;
  }

  const date = Date.parse(header);
  return Number.isNaN(date) ? null : Math.max(0, date - Date.now());
}

// Redirects are never followed automatically, so every hop can be reported.
function createRequester(options) {
  const headers = {
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en',
    'User-Agent': options.userAgent || DEFAULT_USER_AGENT,
    ...(options.headers || {})
  };
  const timeout = options.timeout || 15000;
  const retries = options.retries === undefined ? 2 : options.retries;
  const retryDelay = options.retryDelay === undefined ? 1000 : options.retryDelay;
  const delay = options.delay || 0;
  const signal = options.signal;
  const authHosts = new Set((options.authHosts || []).map((host) => host.toLowerCase()));
  const nextSlot = new Map();
  // Per-host minimum spacing, e.g. a robots.txt Crawl-delay.
  const hostDelays = new Map();

  if (signal) {
    // One abort listener per in-flight request.
    require('events').setMaxListeners(1000, signal);
  }

  let authHeader = '';
  if (options.auth && (options.auth.username || options.auth.password)) {
    const token = Buffer.from(`${options.auth.username || ''}:${options.auth.password || ''}`).toString('base64');
    authHeader = `Basic ${token}`;
  }

  async function waitForSlot(host) {
    const spacing = Math.max(delay, hostDelays.get(host) || 0);
    if (!spacing) {
      return;
    }

    const now = Date.now();
    const slot = Math.max(now, nextSlot.get(host) || 0);
    nextSlot.set(host, slot + spacing);
    if (slot > now) {
      await sleep(slot - now, signal);
    }
  }

  async function attempt(url, method, readBody) {
    if (signal && signal.aborted) {
      throw new AbortedError();
    }

    const host = new URL(url).host.toLowerCase();
    await waitForSlot(host);

    const controller = new AbortController();
    const onAbort = () => controller.abort();
    const timer = setTimeout(() => controller.abort(), timeout);
    const requestHeaders = { ...headers };
    const startedAt = Date.now();

    if (signal) {
      signal.addEventListener('abort', onAbort, { 'once': true });
    }

    // Never send credentials to external links.
    if (authHeader && authHosts.has(new URL(url).hostname.toLowerCase())) {
      requestHeaders['Authorization'] = authHeader;
    }

    try {
      const response = await fetch(url, {
        'headers': requestHeaders,
        'method': method,
        'redirect': 'manual',
        'signal': controller.signal
      });
      const contentType = response.headers.get('content-type') || '';
      const contentLength = parseInt(response.headers.get('content-length') || '0', 10);

      let body = null;
      if (readBody && response.ok && contentLength <= MAX_BODY_BYTES) {
        body = Buffer.from(await response.arrayBuffer());
        if (body.length > MAX_BODY_BYTES) {
          body = null;
        }
      } else if (response.body) {
        await response.body.cancel().catch(() => {});
      }

      return {
        'body': body,
        'contentType': contentType,
        'location': response.headers.get('location'),
        'responseTime': Date.now() - startedAt,
        'botProtection': detectBotProtection(response),
        'retryAfter': response.headers.get('retry-after'),
        'status': response.status,
        'statusText': response.statusText
      };
    } catch (error) {
      if (signal && signal.aborted) {
        throw new AbortedError();
      }

      if (error.name === 'AbortError') {
        const timeoutError = new Error(`Timeout after ${timeout / 1000}s`);
        timeoutError.code = 'TIMEOUT';
        throw timeoutError;
      }

      const cause = error.cause || {};
      const wrapped = new Error(cause.code ? `${cause.code}${cause.message ? ': ' + cause.message : ''}` : error.message);
      wrapped.code = cause.code;
      throw wrapped;
    } finally {
      clearTimeout(timer);
      if (signal) {
        signal.removeEventListener('abort', onAbort);
      }
    }
  }

  async function request(url, { method = 'GET', readBody = false } = {}) {
    for (let tryNumber = 0; ; tryNumber++) {
      let response;
      try {
        response = await attempt(url, method, readBody);
      } catch (error) {
        if (error instanceof AbortedError || tryNumber >= retries || !RETRY_ERRORS.includes(error.code)) {
          throw error;
        }

        await sleep(retryDelay * 2 ** tryNumber, signal);
        continue;
      }

      if (tryNumber >= retries || !RETRY_STATUSES.includes(response.status) || response.botProtection) {
        response.retries = tryNumber;
        return response;
      }

      const wait = retryAfterMs(response.retryAfter);
      await sleep(Math.min(MAX_RETRY_WAIT, wait === null ? retryDelay * 2 ** tryNumber : wait), signal);
    }
  }

  request.setHostDelay = (host, ms) => hostDelays.set(host.toLowerCase(), ms);
  return request;
}

// Gunzips .xml.gz sitemaps.
function bodyToText(body) {
  if (!body) {
    return '';
  }

  if (body[0] === 0x1f && body[1] === 0x8b) {
    return zlib.gunzipSync(body).toString('utf8');
  }

  return body.toString('utf8');
}

module.exports = {
  AbortedError,
  DEFAULT_USER_AGENT,
  bodyToText,
  createRequester
};
