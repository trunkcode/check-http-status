# check-http-status

[![NPM version][npm-image]][npm-url]
[![Downloads][downloads-image]][npm-url]
[![Build Status][travis-image]][travis-url]

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
  'sitemap': 'https://www.trunkcode.com/page-sitemap.xml',
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

[npm-image]: https://img.shields.io/npm/v/check-http-status.svg
[npm-url]: https://www.npmjs.com/package/check-http-status
[downloads-image]: https://img.shields.io/npm/dt/check-http-status.svg

[travis-image]: https://api.travis-ci.com/trunkcode/check-http-status.svg?branch=main
[travis-url]: https://travis-ci.com/trunkcode/check-http-status
