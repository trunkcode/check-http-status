'use strict';

const axios = require('axios');
const xml2js = require('xml2js');

/**
 * Fetch Sitemap URL and dumb all the URLs from the XML to a variable.
 */
function fetchFromSitemap(sitemapUrl) {
  var errorMessage = 'Error: Sitemap URL returns with status code ';
  var fetchedUrls = [];

  return new Promise((resolve) => {
    axios.get(sitemapUrl)
      .then((response) => {
        if (response.status === 200) {
          if (response.data.indexOf('<?xml') === -1) {
            console.error('\x1b[31m%s\x1b[0m', 'Error: Not a XML file.');
          } else {
            const parser = new xml2js.Parser();

            parser.parseString(response.data, (err, result) => {
              for (const readUrl of result.urlset.url) {
                fetchedUrls.push(readUrl.loc[0]);
              }
            });
          }
        }

        resolve(fetchedUrls);
      })
      .catch((error) => {
        if (error.response && error.response.status) {
          errorMessage += error.response.status;
          console.error('\x1b[31m%s\x1b[0m', errorMessage);
        } else {
          console.error(error);
        }

        resolve(fetchedUrls);
      });
  });
}

module.exports = fetchFromSitemap;
