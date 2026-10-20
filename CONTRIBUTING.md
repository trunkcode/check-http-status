# Contributing

Thanks for helping out! Bug reports, ideas and pull requests are all welcome. Please follow
the [code of conduct](CODE_OF_CONDUCT.md).

## Development

```bash
npm install
npm run lint
npm run test:types
npm test
```

Tests run against a small fake website in `test/fixtures/site.js`, so they don't need
the network. Add a page there when a new feature needs one.

## Pull requests

- Keep each pull request to one change, and add or update tests for it.
- Update the README, `index.d.ts` and `schema.json` when options or results change,
  and add a line to `CHANGELOG.md`.
- CI runs lint, type checks and tests on Linux, macOS and Windows with Node 20, 22
  and 24; all of them must pass before merging.
- Commits to `main` must be signed.

## Security

Please report vulnerabilities privately; see [SECURITY.md](SECURITY.md).
