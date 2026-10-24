## What and why

## How it was tested

- [ ] `npm test`
- [ ] `npm run typecheck`
- [ ] `npm run demo:build` (and checked in a browser, if the demo changed)

## Checklist

- [ ] `src/istep` and `src/engine` stay pure TypeScript (no DOM / React Native / Node APIs)
- [ ] Safety gates and the sway stop are not loosened
- [ ] `.istep` format changes are reflected in the zod schema, `schema/`, the README and an example
- [ ] `CHANGELOG.md` updated
