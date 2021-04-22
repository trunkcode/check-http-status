'use strict';

const checkStatusCode = require('./check-status-code');

/**
 * List down all the URLs with the status code.
 */
async function httpList(urlsList, configOptions) {
  const httpStatus = [];
  var combineResults = [];

  for (const checkUrl of urlsList) {
    httpStatus.push(checkStatusCode(checkUrl, configOptions));
  }

  const httpResults = await Promise.all(httpStatus);

  for (const status of httpResults) {
    combineResults = combineResults.concat(status);
  }

  return combineResults;
}

module.exports = httpList;
