# Contributing

Thanks for helping. Issues and pull requests are welcome.

## Setup

```bash
git clone https://github.com/LSUDOKO/vega-gated-video-player
cd vega-gated-video-player
npm install
npm test && npm run typecheck
npm run demo:serve   # http://localhost:8080
```

Node 20 or newer.

## Ground rules

- **Keep `src/istep` and `src/engine` pure TypeScript**: no DOM, no React Native, no Node APIs. They run in
  browsers, Node and on Vega.
- **Never loosen safety.** `safety_prerequisite` gates and the sway stop use fixed thresholds from the `.istep`
  file. Adaptive tolerance applies to learning gates only and stays deterministic code.
- **Validate external data** with zod. Don't trust a track or a frame because it type-checks.
- **Test your change.** Engine and controller changes need vitest tests (`npm test`). If you touch the demo,
  keep `demo/sim.test.ts` green and check it in a browser.
- **Format changes** (new gate types or fields) go into the zod schema, the JSON Schema in `schema/`, the README
  table and an example track.
- No invented numbers in docs: every claim should match the code.

## Pull requests

- One topic per pull request, with a short description of what and why.
- Conventional commit messages are appreciated (`feat:`, `fix:`, `docs:`, `test:`, `chore:`).
- Add a line to `CHANGELOG.md` under an "Unreleased" heading.

This repository is generated from the [InStep monorepo](https://github.com/LSUDOKO/InStep) by
`scripts/export-oss.mjs`; accepted changes are carried back there.

By contributing you agree that your work is licensed under the MIT License, and you agree to follow the
[Code of Conduct](CODE_OF_CONDUCT.md).
