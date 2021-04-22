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
  'urls': [
    'https://trunkcode.com/',
    'https://example.com/',
    'https://example1234.com/',
    'https://www.trunkcode.com/',
    'https://www.trunkcode.com/test/'
  ]
});
