'use strict';

const { ISSUE_CATEGORIES, SCOPE_LABELS } = require('../checker');

const ISSUE_ORDER = ['Not Found', 'Client Error', 'Server Error', 'Error', 'Redirect'];
// Excel cells hold at most 32,767 characters.
const MAX_CELL_LENGTH = 30000;

function statusLabel(result) {
  if (result.error) {
    return result.error;
  } else if (result.status === null || result.status === undefined) {
    return '';
  }

  return `${result.status}${result.statusText ? ' ' + result.statusText : ''}`;
}

function foundOnLabel(result) {
  const lines = [];
  let length = 0;

  for (const source of result.foundOn) {
    if (length + source.page.length + 1 > MAX_CELL_LENGTH) {
      lines.push(`… and ${result.foundOn.length - lines.length} more (see the JSON or HTML report)`);
      break;
    }

    lines.push(source.page);
    length += source.page.length + 1;
  }

  return lines.join('\n');
}

function finalUrlLabel(result) {
  if (!result.finalUrl) {
    return '';
  }

  return result.note ? `${result.finalUrl} (${result.note.toLowerCase()})` : result.finalUrl;
}

const byTypeThenUrl = (a, b) => (a.type === b.type ? 0 : a.type === 'internal' ? -1 : 1) || a.url.localeCompare(b.url);
const byIssueThenUrl = (a, b) => ISSUE_ORDER.indexOf(a.category) - ISSUE_ORDER.indexOf(b.category) || a.url.localeCompare(b.url);

function toRow(result) {
  return {
    'category': result.category,
    'contentType': result.contentType,
    'depth': result.depth,
    'finalStatus': result.finalStatus === null ? '' : result.finalStatus,
    'finalUrl': finalUrlLabel(result),
    'foundOn': foundOnLabel(result),
    'foundOnCount': result.foundOn.length,
    'inSitemap': result.inSitemap ? 'Yes' : '',
    'linkType': result.linkType,
    'orphan': result.orphan ? 'Yes' : '',
    'redirectCount': result.redirectCount || '',
    'redirectTo': result.redirectTo,
    'responseTime': result.responseTime === null ? '' : result.responseTime,
    'scope': SCOPE_LABELS[result.scope] || result.scope,
    'status': result.category === 'Not checked' && result.type === 'external' ? 'Not checked (external checks off)' : statusLabel(result),
    'title': result.title,
    'type': result.type,
    'url': result.url
  };
}

function urlRows(results) {
  return [...results].sort(byTypeThenUrl).map(toRow);
}

function issueRows(results) {
  return results.filter((result) => ISSUE_CATEGORIES.includes(result.category)).sort(byIssueThenUrl).map(toRow);
}

function externalRows(results) {
  return results.filter((result) => result.type === 'external').sort(byTypeThenUrl).map(toRow);
}

module.exports = {
  externalRows,
  issueRows,
  statusLabel,
  urlRows
};
