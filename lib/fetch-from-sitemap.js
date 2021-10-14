'use strict';

const axios = require('axios');
const xml2js = require('xml2js');

/**
 * Fetch Sitemap URL and dumb all the URLs from the XML to a variable.
 *
 * @param string sitemapUrl Sitemap URL from which list of URLs needs to be fetched.
 *
 * @returns array List of URLs fetched from the sitemap.
 */
function fetchFromSitemap(sitemapUrl) {
  var errorMessage = 'Error: ' + sitemapUrl + ' returns with status code ';
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

/**
 * Fetch URLs from the sitemap one-by-one.
 *
 * @param array sitemapUrls List of Sitemap URL(s).
 *
 * @returns array List of URLs fetched from all the sitemap(s).
 */
async function fetchAllSitemaps(sitemapUrls) {
  const sitemapUrlsLists = [];
  const urlsList = [];

  var mergeLists = [];
  for (const sitemapUrl of sitemapUrls) {
    sitemapUrlsLists.push(fetchFromSitemap(sitemapUrl));
  }

  const allUrls = await Promise.all(sitemapUrlsLists);
  for (const singleList of allUrls) {
    mergeLists = mergeLists.concat(singleList);
  }

  for (const singleUrl of mergeLists) {
    if (!urlsList.includes(singleUrl)) {
      urlsList.push(singleUrl);
    }
  }

  return urlsList;
}

module.exports = fetchAllSitemaps;
