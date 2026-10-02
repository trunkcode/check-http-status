'use strict';

const { DEFAULT_USER_AGENT, bodyToText } = require('./request');

const MAX_CRAWL_DELAY = 30 * 1000;

// e.g. "MyBot/1.0 (+https://…)" → "mybot"
function productToken(userAgent) {
  const ua = userAgent || DEFAULT_USER_AGENT;
  const compatible = ua.match(/compatible;\s*([^/;\s)]+)/i);
  const token = compatible ? compatible[1] : ua.split(/[\s/]/)[0];
  return token.toLowerCase();
}

// RFC 9309
function parseRobots(text, token) {
  const groups = [];
  let current = null;
  let lastWasAgent = false;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    const match = line.match(/^([a-z-]+)\s*:\s*(.*)$/i);
    if (!match) {
      continue;
    }

    const field = match[1].toLowerCase();
    const value = match[2].trim();

    if (field === 'user-agent') {
      // Consecutive user-agent lines share one group.
      if (!current || !lastWasAgent) {
        current = { 'agents': [], 'crawlDelay': null, 'rules': [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }

    lastWasAgent = false;
    if (!current) {
      continue;
    }

    if ((field === 'allow' || field === 'disallow') && value) {
      current.rules.push({ 'allow': field === 'allow', 'pattern': value });
    } else if (field === 'crawl-delay' && !Number.isNaN(Number(value))) {
      current.crawlDelay = Number(value) * 1000;
    }
  }

  // Use the groups naming this crawler; fall back to "*".
  let matching = groups.filter((group) => group.agents.includes(token));
  if (!matching.length) {
    matching = groups.filter((group) => group.agents.includes('*'));
  }

  const delays = matching.map((group) => group.crawlDelay).filter((delay) => delay !== null);
  return {
    'crawlDelay': delays.length ? Math.min(MAX_CRAWL_DELAY, Math.max(...delays)) : null,
    'rules': matching.flatMap((group) => group.rules)
  };
}

function patternToRegExp(pattern) {
  const anchored = pattern.endsWith('$');
  const body = (anchored ? pattern.slice(0, -1) : pattern)
    .replace(/[.+?^{}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*');
  return new RegExp('^' + body + (anchored ? '$' : ''));
}

// The longest matching rule wins; Allow wins a tie.
function isAllowed(rules, url) {
  const target = url.pathname + url.search;
  let best = null;

  for (const rule of rules) {
    let pathToMatch = target;
    try {
      // Rules may be written percent-encoded or not; compare like with like.
      pathToMatch = /%[0-9a-f]{2}/i.test(rule.pattern) ? target : decodeURI(target);
    } catch {
      // Keep the raw path if it isn't valid percent-encoding.
    }

    if (!patternToRegExp(rule.pattern).test(pathToMatch)) {
      continue;
    }

    const length = rule.pattern.length;
    if (!best || length > best.length || (length === best.length && rule.allow)) {
      best = { 'allow': rule.allow, length };
    }
  }

  return !best || best.allow;
}

function createRobots(request, userAgent) {
  const token = productToken(userAgent);
  const cache = new Map();

  function load(origin) {
    if (!cache.has(origin)) {
      cache.set(origin, (async () => {
        try {
          // RFC 9309: follow up to five redirects.
          let url = `${origin}/robots.txt`;
          let response = await request(url, { 'readBody': true });
          for (let hops = 0; hops < 5 && response.status >= 300 && response.status < 400 && response.location; hops++) {
            url = new URL(response.location, url).href;
            response = await request(url, { 'readBody': true });
          }

          if (response.status >= 200 && response.status < 300) {
            return parseRobots(bodyToText(response.body), token);
          } else if (response.status >= 500) {
            // RFC 9309: an unreachable robots.txt means "disallow everything".
            return { 'crawlDelay': null, 'disallowAll': true, 'rules': [] };
          }
        } catch (error) {
          if (error.name === 'AbortedError') {
            throw error;
          }
          return { 'crawlDelay': null, 'disallowAll': true, 'rules': [] };
        }

        // 4xx (usually 404): no restrictions.
        return { 'crawlDelay': null, 'rules': [] };
      })());
    }

    return cache.get(origin);
  }

  return {
    async check(href) {
      const url = new URL(href);
      const robots = await load(url.origin);
      return {
        'allowed': !robots.disallowAll && isAllowed(robots.rules, url),
        'crawlDelay': robots.crawlDelay
      };
    },
    token
  };
}

module.exports = {
  createRobots,
  isAllowed,
  parseRobots,
  productToken
};
