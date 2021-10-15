'use strict';

const checkHttpStatus = require('check-http-status');

checkHttpStatus({
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
	'urls': [
		'https://example.com/',
		'https://example1234.com/',
		'https://www.trunkcode.com/test/'
	]
});
