'use strict';

const globals = require('globals');
const js = require('@eslint/js');

module.exports = [
  {
    'ignores': ['docs/**', 'node_modules/**']
  },
  js.configs.recommended,
  {
    'files': ['**/*.js'],
    'languageOptions': {
      'ecmaVersion': 2022,
      'globals': globals.node,
      'sourceType': 'commonjs'
    }
  }
];
