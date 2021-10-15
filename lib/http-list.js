'use strict';

const checkStatusCode = require('./check-status-code');

/**
 * Show Progress of HTTP Status.
 *
 * @param int progressStatus Currently Processing URL(s).
 * @param int totalList Total URL(s) needs to be processed.
 */
function printProgress(progressList, totalList) {
	process.stdout.clearLine();
	process.stdout.cursorTo(0);
	process.stdout.write('Processing ' + progressList + ' of ' + totalList + ' ...	');
}

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
	const totalUrls = urlsList.length;

	var combineResults = [];
	var currentProgress = 0;
	var maxLimit = 0;


	printProgress(currentProgress, totalUrls);
	for (const checkUrl of urlsList) {
		httpStatus.push(checkStatusCode(checkUrl, configOptions, skip200));
		currentProgress += 1;
		maxLimit += 1;

		printProgress(currentProgress, totalUrls);

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
