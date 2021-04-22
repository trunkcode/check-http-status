'use strict';

const axios = require('axios');

/**
 * Check HTTP Status as per settings and return status code and other
 * information for further process.
 */
function axiosRequest(urlToCheck, axiosOptions, redirect) {
  var httpStatus = [
    '',
    0,
    '',
    urlToCheck,
    ''
  ];

  if (!redirect) {
    httpStatus[0] = urlToCheck;
  }

  return new Promise((resolve) => {
    axios.get(urlToCheck, axiosOptions)
      .then((response) => {
        httpStatus[2] = response.status;
        if (redirect) {
          httpStatus[1] = '';
        }

        resolve(httpStatus);
      })
      .catch(async (error) => {
        var statusLists = [];

        if (error.response && error.response.status) {
          httpStatus[2] = error.response.status;
          if (error.response.status >= 300 && error.response.status < 400) {
            const redUrl = error.response.headers.location;
            const checkType = await axiosRequest(redUrl, axiosOptions, true);

            httpStatus[3] = error.response.headers.location;
            statusLists[0] = httpStatus;

            if (redirect) {
              httpStatus[1] = '';
            } else if (typeof checkType[0] === 'object') {
              httpStatus[1] = checkType.length;
            } else {
              httpStatus[1] = 1;
            }

            if (!redirect && typeof checkType[0] === 'object') {
              let childLinks = 1;
              checkType.forEach((element) => {
                statusLists[childLinks] = element;
                childLinks += 1;
              });
            } else {
              statusLists[1] = checkType;
            }
          } else {
            statusLists = httpStatus;
          }
        } else {
          httpStatus[1] = '';
          httpStatus[3] = '';
          if (error.message) {
            httpStatus[4] = error.message;
          } else {
            httpStatus[4] = error;
          }

          statusLists = httpStatus;
        }

        resolve(statusLists);
      });
  });
}

/**
 * Call main function to generate array with all the required information
 * and await until that all are not completed.
 */
async function checkStatusCode(urlToCheck, options) {
  const statusList = [];

  var axiosOptions = {
    'maxRedirects': 0
  };
  var statusArray = [];

  // Custom headers to be sent.
  if (options.headers) {
    axiosOptions.headers = options.headers;
  }

  // Specifies the number of milliseconds before the request times out.
  if (options.timeout) {
    axiosOptions.timeout = options.timeout;
  }

  // Indicates that HTTP Basic auth should be used, and supplies credentials.
  if (options.auth) {
    axiosOptions.auth = options.auth;
  }

  statusArray = await axiosRequest(urlToCheck, axiosOptions);
  if (typeof statusArray[0] === 'object') {
    statusArray.forEach((row) => {
      statusList.push(row);
    });
  } else {
    statusList.push(statusArray);
  }

  return Promise.resolve(statusList);
}

module.exports = checkStatusCode;
