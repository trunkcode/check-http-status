# check-http-status

[![NPM version][npm-image]][npm-url]
[![Downloads][downloads-image]][npm-url]
[![Build Status][travis-image]][travis-url]

Easily check status codes, response headers, and redirect chains in `Node.js`
similar as done from the [httpstatus](https://httpstatus.io/) website.

When the site is on VPN so this is where it plays an important role. You can
simply connect your system/machine with VPN and run this package locally so it
can check the status of your VPN connected URL(s).

It can also check the website that are secured with HTTP Authentication.

## Install

Via `npm`

```bash
npm install check-http-status --save-dev
```

Via Yarn

```bash
yarn add check-http-status --dev
```

## Examples

### Status Code of the Sitemap(s) URL(s)

```node
const checkHttpStatus = require('check-http-status');

checkHttpStatus({
	'sitemaps':  [
    'https://www.trunkcode.com/page-sitemap.xml',
    'https://www.trunkcode.com/post-sitemap.xml'
  ],
	'skip200': true, // Do not report the URLs having HTTP code 200.
  'export': {
    'format': 'xlsx',
    'location': '/Users/trunkcode/Desktop/',
  },
  'options': {
    'auth': {
      'password': 'Testing1234',
      'username': 'trunkcode'
    },
    'headers': {
      'Accept': 'text/html',
    }
  }
});
```

### Status Code of the particular URL(s)

```node
const checkHttpStatus = require('check-http-status');

checkHttpStatus({
	'urls': [
    'http://trunkcode.com/',
    'https://example.com/',
    'https://example1234.com/',
    'https://www.trunkcode.com/',
    'https://www.trunkcode.com/test/'
  ],
	'skip200': true, // Do not report the URLs having HTTP code 200.
  'export': {
    'format': 'xlsx',
    'location': '/Users/trunkcode/Desktop/',
  },
  'options': {
    'auth': {
      'password': 'Testing1234',
      'username': 'trunkcode'
    },
    'headers': {
      'Accept': 'text/html',
    }
  }
});
```

### Status Code of the Sitemap(s) URL(s) with particular URL(s)

```node
const checkHttpStatus = require('check-http-status');

checkHttpStatus({
	'sitemaps':  [
    'https://www.trunkcode.com/page-sitemap.xml',
    'https://www.trunkcode.com/post-sitemap.xml'
  ],
	'urls': [
    'http://trunkcode.com/',
    'https://example.com/',
    'https://example1234.com/',
    'https://www.trunkcode.com/',
    'https://www.trunkcode.com/test/'
  ],
	'skip200': true, // Do not report the URLs having HTTP code 200.
  'export': {
    'format': 'xlsx',
    'location': '/Users/trunkcode/Desktop/',
  },
  'options': {
    'auth': {
      'password': 'Testing1234',
      'username': 'trunkcode'
    },
    'headers': {
      'Accept': 'text/html',
    }
  }
});
```

## Parameters

| Attributes |   Type  | Required | Default |                                            Description                                           |
|:----------:|:-------:|:--------:|:-------:|:------------------------------------------------------------------------------------------------:|
|  sitemaps  |  Array  |    Yes   |         | Sitemap(s) URL(s) where the Actual site URL(s) needs to be fetched for checking the HTTP Status. |
|    urls    |  Array  |    Yes   |         | URL(s) for which HTTP Status needs to be checked.                                                |
|   skip200  | Boolean |    No    | `false` | Whether to list the HTTP status `200` URL(s) or not.                                             |
|   export   |  Object |    No    |   `{}`  | Whether to export the status report or not. By default it logs the report on the screen.         |
|   options  |  Object |    No    |   `{}`  | Define options like HTTP Auth credentials if the site is locked or headers etc.                  |

**NOTE:** `sitemaps` or `urls` is required. You can define both parameters as
well to fetch URL(s) from sitemap and the URL(s) that are not listed in the
ssitemap, you can provide them separately.

[npm-image]: https://img.shields.io/npm/v/check-http-status.svg
[npm-url]: https://www.npmjs.com/package/check-http-status
[downloads-image]: https://img.shields.io/npm/dt/check-http-status.svg

[travis-image]: https://api.travis-ci.com/trunkcode/check-http-status.svg?branch=main
[travis-url]: https://travis-ci.com/trunkcode/check-http-status
