'use strict';

const checkStatusCode = require('./check-status-code');

/**
 * List down all the URLs with the status code.
 *
 * @param array urlsList List of URLs.
 * @param object configOptions config options for Axios like HTTP Auth etc.
 * @param bool skip200 Whether to log URLs that returns 200 status code or not.
 *
 * @returns array Result of each requested with its status code etc.
 */
async function httpList(urlsList, configOptions, skip200) {
  const httpStatus = [];

  var combineResults = [];
  var maxLimit = 0;

  for (const checkUrl of urlsList) {
    httpStatus.push(checkStatusCode(checkUrl, configOptions, skip200));
    maxLimit += 1;

    // Resolve previous promises before pushing more.
    if (maxLimit === 10) {
      await Promise.all(httpStatus);
      maxLimit = 0;
    }
  }

  const httpResults = await Promise.all(httpStatus);
  for (const status of httpResults) {
    combineResults = combineResults.concat(status);
  }

  return combineResults;
}

module.exports = httpList;
