'use strict';

const columnify = require('columnify');

/**
 * List down all the URLs with the status code in console.
 *
 * @param array statusList List of URLs with their status code and other
 *                         information to be logged on console.
 */
function terminalColumns(statusList) {
  const data = [];

  // Add empty line
  console.log();

  statusList.forEach((singleStatus) => {
    data.push({
      '# Redirects': singleStatus[1],
      'Error Message': singleStatus[4],
      'Requested URL': singleStatus[0],
      'Status Code': singleStatus[2],
      'URL': singleStatus[3],
    });
  });

  console.log(columnify(data, {
    'columnSplitter': '|',
    'columns': [
      'Requested URL',
      '# Redirects',
      'Status Code',
      'URL',
      'Error Message'
    ]
  }));
}

module.exports = terminalColumns;
