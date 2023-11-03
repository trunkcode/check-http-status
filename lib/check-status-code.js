'use strict';

const axios = require('axios');

/**
 * Check HTTP Status as per settings and return status code and other
 * information for further process.
 *
 * @param string urlToCheck URL that needs to be requested.
 * @param object axiosOptions Axios Options.
 * @param bool redirect Whether the URL is crawling or the redirected URL is crawling.
 *
 * @returns array Response of checked URL.
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
            let redUrl = error.response.headers.location;
            // if relative url, prepend the current protocol and hostname
            if(redUrl.startsWith('/')){
              const url = new URL(urlToCheck);
              redUrl = `${url.protocol}//${url.hostname}${redUrl}`;
            }
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
 *
 * @param string urlToCheck URL that needs to be checked.
 * @param object options Axios options.
 * @param bool skip200 Whether to log URLs that returns 200 status code or not.
 *
 * @returns array List of URLs with their status code and other information.
 */
async function checkStatusCode(urlToCheck, options, skip200) {
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
    if (statusArray[2] !== 200 || !skip200) {
      statusList.push(statusArray);
    }
  }

  return Promise.resolve(statusList);
}

module.exports = checkStatusCode;
