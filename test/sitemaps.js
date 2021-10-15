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
		}
	},
	'sitemaps': [
		'https://www.trunkcode.com/page-sitemap.xml',
		'https://www.trunkcode.com/post-sitemap.xml'
	],
	'skip200': true,
});
