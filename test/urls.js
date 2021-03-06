'use strict';

const checkHttpStatus = require('../index');

checkHttpStatus({
	'export': {
		'format': 'xlsx',
		'location': '/Users/trunkcode/Desktop/',
	},
	'options': {
		'headers': {
			'Accept': 'text/html',
		},
	},
	'skip200': true,
	'urls': [
		'https://trunkcode.com/',
		'https://example.com/',
		'https://example1234.com/',
		'https://www.trunkcode.com/',
		'https://www.trunkcode.com/test/'
	]
});
