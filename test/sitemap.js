'use strict';

const checkHttpStatus = require('../index');

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
  'sitemap': 'https://www.trunkcode.com/page-sitemap.xml'
});
