# Security policy

## Supported versions

Security fixes are released for the latest 2.x version. Please upgrade before
reporting a problem in an older version.

## Reporting a vulnerability

Please **don't open a public issue**. Report it privately through
[GitHub security advisories](https://github.com/trunkcode/check-http-status/security/advisories/new)
instead.

Include the version, how to reproduce the problem and what an attacker could do with
it. You'll get a reply within a week. Once a fix is released, the advisory is
published and you're credited unless you'd rather not be.

## Scope

check-http-status sends requests to the URLs you give it and to the links it finds
on those pages. Things worth reporting include credentials (HTTP Basic auth, cloud
upload tokens) being sent to the wrong host, and crawled content being able to run
script in the HTML report.
