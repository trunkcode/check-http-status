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

## Usage

### Sitemap Example

```node
const checkHttpStatus = require('check-http-status');

checkHttpStatus({
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
    },
  },
  'sitemap':  [
    'https://www.trunkcode.com/page-sitemap.xml',
    'https://www.trunkcode.com/post-sitemap.xml'
  ],
  'skip200': true, // Do not report the URLs having HTTP code 200.
});
```

### URLs Example

```node
const checkHttpStatus = require('check-http-status');

checkHttpStatus({
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
    },
  },
  'skip200': true, // Do not report the URLs having HTTP code 200.
  'urls': [
    'http://trunkcode.com/',
    'https://example.com/',
    'https://example1234.com/',
    'https://www.trunkcode.com/',
    'https://www.trunkcode.com/test/'
  ]
});
```

## Parameters

| Attributes |   Type  | Required | Default |                                          Description                                          |
|:----------:|:-------:|:--------:|:-------:|:---------------------------------------------------------------------------------------------:|
|   sitemap  |  Array  |    Yes   |         | Sitemap URL(s) where the Actual site URL(s) needs to be fetched for checking the HTTP Status. |
|    urls    |  Array  |    Yes   |         | URL(s) for which HTTP Status needs to be checked.                                             |
|   skip200  | Boolean |    No    | `false` | Whether to list the HTTP status `200` URL(s) or not.                                          |
|   export   |  Object |    No    |   `{}`  | Whether to export the status report or not. By default it logs the report on the screen.      |
|   options  |  Object |    No    |   `{}`  | Define options like HTTP Auth credentials if the site is locked or headers etc.               |

**NOTE:** `sitemap` or `urls` is required.

[npm-image]: https://img.shields.io/npm/v/check-http-status.svg
[npm-url]: https://www.npmjs.com/package/check-http-status
[downloads-image]: https://img.shields.io/npm/dt/check-http-status.svg

[travis-image]: https://api.travis-ci.com/trunkcode/check-http-status.svg?branch=main
[travis-url]: https://travis-ci.com/trunkcode/check-http-status
