'use strict';

const excelJS = require('exceljs');

/**
 * Generate filename with location to save the exported file.
 */
function exportFileName(exportDetails) {
  const currentTimestamp = Math.floor(Date.now() / 1000);
  const fileNameSuffix = currentTimestamp + '.' + exportDetails.format;
  const fileName = 'httpstatuschecker-results-' + fileNameSuffix;
  const location = exportDetails.location + fileName;

  return location;
}

/**
 * List down all the URLs with the status code in .xlsx format.
 */
function generateExcel(statusList, rowLength, exportDetails) {
  const location = exportFileName(exportDetails);
  const workbook = new excelJS.Workbook();
  const worksheet = workbook.addWorksheet('Sheet 1', {
    'views': [
      {
        'state': 'frozen',
        'xSplit': 1,
        'ySplit': 1
      }
    ]
  });

  worksheet.columns = [
    {
      'header': 'Requested URL',
      'key': 'url',
      'width': rowLength.requestedUrl
    },
    {
      'header': '# Redirects',
      'key': 'redirects',
      'width': 12
    },
    {
      'header': 'Status Code',
      'key': 'status',
      'width': 12
    },
    {
      'header': 'URL',
      'key': 'url',
      'width': rowLength.url
    },
    {
      'header': 'Error Message',
      'key': 'error_message',
      'width': rowLength.errorMessage
    },
  ];

  worksheet.getRow(1).font = {
    'bold': true
  };

  worksheet.addRows(statusList);
  workbook[exportDetails.format].writeFile(location);
}

module.exports = generateExcel;
