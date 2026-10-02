'use strict';

// Rules: "/regex/flags", "*" wildcard, or a case-insensitive substring.
function compilePatterns(input) {
  let rules = input;
  if (!Array.isArray(rules)) {
    rules = String(rules || '').split(/\r?\n|,/);
  }

  return rules
    .map((rule) => String(rule).trim())
    .filter(Boolean)
    .map((rule) => {
      const regex = rule.match(/^\/(.+)\/([imsuy]*)$/);
      if (regex) {
        return new RegExp(regex[1], regex[2]);
      }

      if (rule.includes('*')) {
        const escaped = rule.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
        return new RegExp(escaped, 'i');
      }

      const needle = rule.toLowerCase();
      return {
        'test': (url) => url.toLowerCase().includes(needle)
      };
    });
}

module.exports = compilePatterns;
